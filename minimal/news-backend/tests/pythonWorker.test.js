const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const { PythonWorker } = require('../services/pythonWorker');

// A fake child process: `respond(payload)` decides what the "script" answers
// for each request line (an object to send, or null to stay silent).
const createFakeSpawn = (respond) => {
  const spawned = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit('close', null, 'SIGKILL'));
      return true;
    };
    let buffer = '';
    child.stdin.on('data', (chunk) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const request = JSON.parse(line);
        const reply = respond(request, child);
        if (reply) setImmediate(() => child.stdout.write(`${JSON.stringify({ id: request.id, ...reply })}\n`));
        newline = buffer.indexOf('\n');
      }
    });
    child.stdin.on('finish', () => setImmediate(() => child.emit('close', 0, null)));
    spawned.push(child);
    return child;
  };
  return { spawnImpl, spawned };
};

const quietLogger = { warn: () => {} };

test('worker keeps one process alive across requests', async () => {
  const { spawnImpl, spawned } = createFakeSpawn((request) => ({ ok: true, text: `echo:${request.text}` }));
  const worker = new PythonWorker({ name: 'test', scriptPath: 'x.py', spawnImpl, logger: quietLogger });

  const [first, second] = await Promise.all([
    worker.request({ text: 'a' }),
    worker.request({ text: 'b' })
  ]);

  assert.equal(first.text, 'echo:a');
  assert.equal(second.text, 'echo:b');
  assert.equal(spawned.length, 1, 'model process is reused, not respawned per request');
  worker.stop();
});

test('script errors reject only the failing request', async () => {
  const { spawnImpl } = createFakeSpawn((request) => (
    request.text === 'bad' ? { ok: false, error: 'Empty text' } : { ok: true, text: 'fine' }
  ));
  const worker = new PythonWorker({ name: 'test', scriptPath: 'x.py', spawnImpl, logger: quietLogger });

  await assert.rejects(worker.request({ text: 'bad' }), (error) => {
    assert.equal(error.message, 'Empty text');
    assert.equal(error.code, 'WORKER_REQUEST_FAILED');
    return true;
  });
  assert.equal((await worker.request({ text: 'good' })).text, 'fine');
  worker.stop();
});

test('a hung request times out and the next request gets a fresh process', async () => {
  const { spawnImpl, spawned } = createFakeSpawn((request) => (
    request.text === 'hang' ? null : { ok: true, text: 'recovered' }
  ));
  const worker = new PythonWorker({
    name: 'test',
    scriptPath: 'x.py',
    spawnImpl,
    requestTimeoutMs: 30,
    logger: quietLogger
  });

  await assert.rejects(worker.request({ text: 'hang' }), (error) => error.code === 'WORKER_TIMEOUT');
  assert.equal(spawned[0].killed, true, 'the stuck process is killed');
  assert.equal((await worker.request({ text: 'next' })).text, 'recovered');
  assert.equal(spawned.length, 2);
  worker.stop();
});

test('a crashing process rejects the in-flight request with its stderr', async () => {
  const { spawnImpl } = createFakeSpawn((request, child) => {
    child.stderr.write('ModuleNotFoundError: No module named torch\n');
    setImmediate(() => child.emit('close', 1, null));
    return null;
  });
  const worker = new PythonWorker({ name: 'mBART worker', scriptPath: 'x.py', spawnImpl, logger: quietLogger });

  await assert.rejects(worker.request({ text: 'x' }), (error) => {
    assert.equal(error.code, 'WORKER_EXITED');
    assert.match(error.message, /No module named torch/);
    return true;
  });
  worker.stop();
});

test('queue is bounded and stop() rejects pending work', async () => {
  const { spawnImpl } = createFakeSpawn(() => null);
  const worker = new PythonWorker({
    name: 'test',
    scriptPath: 'x.py',
    spawnImpl,
    maxQueue: 1,
    requestTimeoutMs: 10000,
    logger: quietLogger
  });

  const running = worker.request({ text: 'one' });
  const queued = worker.request({ text: 'two' });
  await assert.rejects(worker.request({ text: 'three' }), (error) => error.code === 'WORKER_BUSY');

  worker.stop();
  await assert.rejects(running, (error) => error.code === 'WORKER_STOPPED');
  await assert.rejects(queued, (error) => error.code === 'WORKER_STOPPED');
  await assert.rejects(worker.request({ text: 'after' }), (error) => error.code === 'WORKER_STOPPED');
});

test('idle workers release the process', async () => {
  const { spawnImpl, spawned } = createFakeSpawn(() => ({ ok: true }));
  const worker = new PythonWorker({
    name: 'test',
    scriptPath: 'x.py',
    spawnImpl,
    idleTimeoutMs: 20,
    logger: quietLogger
  });

  await worker.request({ text: 'a' });
  assert.equal(worker.running, true);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(worker.running, false);
  assert.equal(spawned[0].stdin.writableEnded, true, 'stdin is closed so the script exits cleanly');

  await worker.request({ text: 'b' });
  assert.equal(spawned.length, 2, 'a new process starts on demand');
  worker.stop();
});
