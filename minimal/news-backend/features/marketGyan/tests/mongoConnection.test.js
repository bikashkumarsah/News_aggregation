const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isTransientMongoError,
    mongoConnectionOptions,
    withMongoRetry
} = require('../services/mongoConnectionService');

test('MongoDB monitor and network interruptions are retryable', () => {
    assert.equal(isTransientMongoError({
        name: 'MongoServerSelectionError',
        message: 'Connection to localhost:27017 interrupted due to server monitor timeout'
    }), true);
    assert.equal(isTransientMongoError({
        name: 'ValidationError',
        message: 'MarketLabel validation failed'
    }), false);
});

test('MongoDB connection options keep long-running worker sockets alive', () => {
    const options = mongoConnectionOptions();
    assert.equal(options.socketTimeoutMS, 0);
    assert.equal(options.maxIdleTimeMS, 0);
    assert.ok(options.serverSelectionTimeoutMS >= 1000);
    assert.ok(options.heartbeatFrequencyMS >= 500);
});

test('MongoDB operations reconnect and retry transient failures', async () => {
    let operationAttempts = 0;
    let connectAttempts = 0;
    const warnings = [];

    const result = await withMongoRetry(async () => {
        operationAttempts += 1;
        if (operationAttempts < 3) {
            const error = new Error('server monitor timeout');
            error.name = 'MongoServerSelectionError';
            throw error;
        }
        return 'recovered';
    }, {
        maxAttempts: 4,
        operationName: 'Test operation',
        connectFn: async () => {
            connectAttempts += 1;
        },
        sleepFn: async () => {},
        logger: {
            warn: (message) => warnings.push(message)
        }
    });

    assert.equal(result, 'recovered');
    assert.equal(operationAttempts, 3);
    assert.equal(connectAttempts, 3);
    assert.equal(warnings.length, 2);
});

test('MongoDB operations do not retry validation failures', async () => {
    let attempts = 0;
    await assert.rejects(
        withMongoRetry(async () => {
            attempts += 1;
            const error = new Error('MarketLabel validation failed');
            error.name = 'ValidationError';
            throw error;
        }, {
            maxAttempts: Infinity,
            connectFn: async () => {},
            sleepFn: async () => {}
        }),
        /MarketLabel validation failed/
    );
    assert.equal(attempts, 1);
});
