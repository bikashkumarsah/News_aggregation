const mongoose = require('mongoose');

const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017/newsDB';

const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mongoConnectionOptions = () => ({
    serverSelectionTimeoutMS: parsePositiveInteger(
        process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
        30000
    ),
    connectTimeoutMS: parsePositiveInteger(
        process.env.MONGODB_CONNECT_TIMEOUT_MS,
        10000
    ),
    socketTimeoutMS: parsePositiveInteger(
        process.env.MONGODB_SOCKET_TIMEOUT_MS,
        0
    ),
    heartbeatFrequencyMS: parsePositiveInteger(
        process.env.MONGODB_HEARTBEAT_FREQUENCY_MS,
        10000
    ),
    maxIdleTimeMS: parsePositiveInteger(
        process.env.MONGODB_MAX_IDLE_TIME_MS,
        0
    ),
    maxPoolSize: parsePositiveInteger(
        process.env.MONGODB_MAX_POOL_SIZE,
        10
    ),
    minPoolSize: parsePositiveInteger(
        process.env.MONGODB_MIN_POOL_SIZE,
        0
    ),
    family: 4
});

let connectPromise;
let listenersBound = false;
let intentionalDisconnect = false;

const bindConnectionListeners = (logger = console) => {
    if (listenersBound) return;
    listenersBound = true;

    mongoose.connection.on('disconnected', () => {
        if (intentionalDisconnect) return;
        logger.warn?.('MongoDB disconnected; waiting for automatic recovery');
    });
    mongoose.connection.on('reconnected', () => {
        logger.info?.('MongoDB connection restored');
    });
    mongoose.connection.on('error', (error) => {
        logger.error?.(`MongoDB connection error: ${error.message}`);
    });
};

const connectMongo = async ({
    uri = process.env.MONGODB_URI || DEFAULT_MONGODB_URI,
    logger = console
} = {}) => {
    bindConnectionListeners(logger);
    intentionalDisconnect = false;
    if (mongoose.connection.readyState === 1) return mongoose;
    if (connectPromise) return connectPromise;

    connectPromise = mongoose.connect(uri, mongoConnectionOptions())
        .finally(() => {
            connectPromise = undefined;
        });
    return connectPromise;
};

const disconnectMongo = async () => {
    if (mongoose.connection.readyState === 0) return;
    intentionalDisconnect = true;
    try {
        await mongoose.disconnect();
    } finally {
        intentionalDisconnect = false;
    }
};

const isTransientMongoError = (error) => {
    const name = String(error?.name || '');
    const message = String(error?.message || '');
    return [
        'MongoNetworkError',
        'MongoNetworkTimeoutError',
        'MongoServerSelectionError',
        'MongoPoolClearedError',
        'MongoTopologyClosedError'
    ].includes(name)
        || /server monitor timeout|server selection timed out|connection .*interrupted|connection (?:closed|reset)|socket (?:closed|hang up)|topology (?:closed|destroyed)|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i.test(
            message
        );
};

const retryDelay = (attempt) => {
    const base = parsePositiveInteger(process.env.MONGODB_RETRY_DELAY_MS, 1000);
    const maximum = parsePositiveInteger(
        process.env.MONGODB_RETRY_MAX_DELAY_MS,
        30000
    );
    return Math.min(maximum, base * (2 ** Math.min(attempt - 1, 5)));
};

const withMongoRetry = async (operation, {
    maxAttempts = 6,
    operationName = 'MongoDB operation',
    logger = console,
    connectFn = connectMongo,
    sleepFn = sleep
} = {}) => {
    let attempt = 0;
    while (attempt < maxAttempts || maxAttempts === Infinity) {
        attempt += 1;
        try {
            await connectFn({ logger });
            return await operation();
        } catch (error) {
            if (!isTransientMongoError(error)
                || (maxAttempts !== Infinity && attempt >= maxAttempts)) {
                throw error;
            }

            const delayMs = retryDelay(attempt);
            logger.warn?.(
                `${operationName} interrupted (${error.message}); retrying in ${delayMs} ms`
            );
            await sleepFn(delayMs);
        }
    }

    throw new Error(`${operationName} exhausted MongoDB retry attempts`);
};

module.exports = {
    DEFAULT_MONGODB_URI,
    bindConnectionListeners,
    connectMongo,
    disconnectMongo,
    isTransientMongoError,
    mongoConnectionOptions,
    retryDelay,
    withMongoRetry
};
