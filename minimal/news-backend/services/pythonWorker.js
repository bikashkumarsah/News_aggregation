const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

/**
 * Long-lived Python helper process speaking newline-delimited JSON.
 *
 * Loading mBART or a Piper voice takes seconds and gigabytes, so the backend
 * keeps one process per model family alive and sends it one request at a
 * time instead of spawning (and re-loading the model) for every call.
 *
 * Protocol: Node writes `{"id": n, ...payload}\n`; the script answers with
 * `{"id": n, "ok": true|false, ...}\n`. Requests are serialized, each one has
 * its own timeout, a crashed or hung process is replaced on the next request,
 * and the process is shut down after a period of inactivity to free memory.
 */

const STDERR_TAIL_CHARS = 4000;

const workerError = (message, code, status = 503) => Object.assign(new Error(message), {
    code,
    status
});

class PythonWorker {
    constructor({
        name,
        scriptPath,
        args = ['--serve'],
        env = process.env,
        pythonBin = process.env.PYTHON_BIN || 'python3',
        requestTimeoutMs = 180000,
        idleTimeoutMs = 10 * 60 * 1000,
        maxQueue = 20,
        spawnImpl = spawn,
        logger = console
    }) {
        this.name = name || 'Python worker';
        this.scriptPath = scriptPath;
        this.args = args;
        this.env = env;
        this.pythonBin = pythonBin;
        this.requestTimeoutMs = requestTimeoutMs;
        this.idleTimeoutMs = idleTimeoutMs;
        this.maxQueue = maxQueue;
        this.spawnImpl = spawnImpl;
        this.logger = logger;

        this.queue = [];
        this.current = null;
        this.child = null;
        this.seq = 0;
        this.idleTimer = null;
        this.stopped = false;
    }

    get pending() {
        return this.queue.length + (this.current ? 1 : 0);
    }

    get running() {
        return Boolean(this.child);
    }

    request(payload, { timeoutMs } = {}) {
        if (this.stopped) {
            return Promise.reject(workerError(`${this.name} is stopped`, 'WORKER_STOPPED'));
        }
        if (this.queue.length >= this.maxQueue) {
            return Promise.reject(workerError(
                `${this.name} is busy; please try again shortly`,
                'WORKER_BUSY'
            ));
        }
        return new Promise((resolve, reject) => {
            this.queue.push({
                payload,
                resolve,
                reject,
                timeoutMs: timeoutMs || this.requestTimeoutMs
            });
            this._drain();
        });
    }

    stop() {
        this.stopped = true;
        this._clearIdleTimer();
        const stoppedError = () => workerError(`${this.name} stopped`, 'WORKER_STOPPED');
        for (const job of this.queue.splice(0)) job.reject(stoppedError());
        if (this.current) {
            const job = this.current;
            this.current = null;
            clearTimeout(job.timer);
            job.reject(stoppedError());
        }
        this._shutdownChild();
    }

    _spawn() {
        const child = this.spawnImpl(this.pythonBin, [this.scriptPath, ...this.args], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: this.env
        });
        this.child = child;

        const decoder = new StringDecoder('utf8');
        let buffer = '';
        let stderrTail = '';
        let exited = false;

        child.stdout.on('data', (chunk) => {
            buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (line) this._onLine(child, line);
                newline = buffer.indexOf('\n');
            }
        });
        child.stderr?.on('data', (chunk) => {
            stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
        });
        // Writing to a process that already died raises EPIPE here; the exit
        // handler below reports the failure to the waiting request.
        child.stdin?.on?.('error', () => {});

        const onExit = (error, code, signal) => {
            if (exited) return;
            exited = true;
            if (this.child === child) this.child = null;
            this._onChildExit(child, { error, code, signal, stderrTail });
        };
        child.on('error', (error) => onExit(error));
        child.on('close', (code, signal) => onExit(null, code, signal));
        return child;
    }

    _drain() {
        if (this.current || !this.queue.length || this.stopped) return;
        this._clearIdleTimer();

        const job = this.queue.shift();
        let child;
        try {
            child = this.child || this._spawn();
        } catch (error) {
            job.reject(workerError(`${this.name} failed to start: ${error.message}`, 'WORKER_START_FAILED'));
            setImmediate(() => this._drain());
            return;
        }

        this.seq += 1;
        job.id = this.seq;
        job.child = child;
        this.current = job;
        job.timer = setTimeout(() => this._onTimeout(job), job.timeoutMs);

        try {
            child.stdin.write(`${JSON.stringify({ ...job.payload, id: job.id })}\n`);
        } catch (error) {
            this._detachChild(child);
            this._finishCurrent(job, workerError(`${this.name} is unavailable: ${error.message}`, 'WORKER_WRITE_FAILED'));
        }
    }

    _onLine(child, line) {
        let message;
        try {
            message = JSON.parse(line);
        } catch {
            this.logger.warn?.(`[${this.name}] ignored non-JSON output: ${line.slice(0, 200)}`);
            return;
        }

        const job = this.current;
        if (!job || job.child !== child || message.id !== job.id) return;

        if (message.ok) {
            this._finishCurrent(job, null, message);
        } else {
            this._finishCurrent(job, workerError(
                message.error || `${this.name} request failed`,
                'WORKER_REQUEST_FAILED',
                502
            ));
        }
    }

    _onTimeout(job) {
        if (this.current !== job) return;
        // The process is still busy with the abandoned request, so replace it.
        this._detachChild(job.child);
        this._finishCurrent(job, workerError(
            `${this.name} timed out after ${job.timeoutMs} ms`,
            'WORKER_TIMEOUT',
            504
        ));
    }

    _onChildExit(child, { error, code, signal, stderrTail }) {
        const job = this.current;
        if (!job || job.child !== child) return;
        const detail = String(stderrTail || '').trim().split('\n').slice(-5).join('\n');
        const reason = error
            ? `failed to start: ${error.message}`
            : `exited unexpectedly (code ${code}${signal ? `, signal ${signal}` : ''})`;
        this._finishCurrent(job, workerError(
            `${this.name} ${reason}${detail ? `: ${detail}` : ''}`,
            'WORKER_EXITED'
        ));
    }

    _finishCurrent(job, error, result) {
        if (this.current !== job) return;
        clearTimeout(job.timer);
        this.current = null;
        if (error) job.reject(error);
        else job.resolve(result);

        if (this.queue.length) this._drain();
        else this._scheduleIdleShutdown();
    }

    _scheduleIdleShutdown() {
        this._clearIdleTimer();
        if (!this.child || this.idleTimeoutMs <= 0) return;
        this.idleTimer = setTimeout(() => {
            if (!this.current && !this.queue.length) this._shutdownChild();
        }, this.idleTimeoutMs);
        this.idleTimer.unref?.();
    }

    _clearIdleTimer() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }

    _detachChild(child) {
        if (!child) return;
        if (this.child === child) this.child = null;
        try {
            child.kill('SIGKILL');
        } catch {
            // already gone
        }
    }

    _shutdownChild() {
        const child = this.child;
        if (!child) return;
        this.child = null;
        // Closing stdin lets the script finish its loop and exit cleanly; kill
        // it if it does not exit promptly.
        try {
            child.stdin?.end?.();
        } catch {
            // ignore
        }
        const killTimer = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            } catch {
                // ignore
            }
        }, 5000);
        killTimer.unref?.();
        child.once?.('close', () => clearTimeout(killTimer));
    }
}

module.exports = {
    PythonWorker,
    workerError
};
