/**
 * Tiny in-process caching helpers.
 */

class LruCache {
    constructor({ maxEntries = 100, ttlMs = 0 } = {}) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
        this.entries = new Map();
    }

    get size() {
        return this.entries.size;
    }

    get(key) {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt && entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }
        // Re-insert to mark as most recently used.
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        if (this.entries.has(key)) this.entries.delete(key);
        this.entries.set(key, {
            value,
            expiresAt: this.ttlMs > 0 ? Date.now() + this.ttlMs : 0
        });
        while (this.entries.size > this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
        }
        return value;
    }

    delete(key) {
        return this.entries.delete(key);
    }

    clear() {
        this.entries.clear();
    }
}

/**
 * Collapse concurrent calls that share a key into one execution: callers that
 * arrive while the work is running receive the same promise.
 */
const createInFlightDeduper = () => {
    const running = new Map();
    const run = (key, task) => {
        if (running.has(key)) return running.get(key);
        const promise = Promise.resolve()
            .then(task)
            .finally(() => running.delete(key));
        running.set(key, promise);
        return promise;
    };
    run.size = () => running.size;
    return run;
};

module.exports = {
    LruCache,
    createInFlightDeduper
};
