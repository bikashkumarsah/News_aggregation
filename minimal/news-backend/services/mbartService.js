const path = require('path');
const { PythonWorker } = require('./pythonWorker');

const SERVICE_PATH = path.join(__dirname, '..', 'mbart_service.py');
const DEFAULT_MBART_MODEL = 'sagunrai/mbart-large-50-nepali-finetuned-1';

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

let sharedWorker = null;

// One long-lived mBART process: the ~2.4 GB model loads on the first request
// and stays resident until MBART_IDLE_TIMEOUT_MS of inactivity.
const createMbartWorker = (env = process.env) => new PythonWorker({
  name: 'mBART worker',
  scriptPath: SERVICE_PATH,
  env: {
    ...env,
    MBART_MODEL: env.MBART_MODEL || DEFAULT_MBART_MODEL,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1'
  },
  // The first request may download and load the model, so allow minutes.
  requestTimeoutMs: positiveInt(env.MBART_TIMEOUT_MS, 10 * 60 * 1000),
  idleTimeoutMs: positiveInt(env.MBART_IDLE_TIMEOUT_MS, 10 * 60 * 1000),
  maxQueue: positiveInt(env.MBART_MAX_QUEUE, 8)
});

const getMbartWorker = () => {
  if (!sharedWorker) sharedWorker = createMbartWorker();
  return sharedWorker;
};

const stopMbartWorker = () => {
  if (sharedWorker) sharedWorker.stop();
  sharedWorker = null;
};

const runMbart = async (
  { task, text, maxNewTokens, maxInputTokens } = {},
  { worker = getMbartWorker() } = {}
) => {
  const response = await worker.request({
    task,
    text,
    ...(maxNewTokens ? { max_new_tokens: maxNewTokens } : {}),
    ...(maxInputTokens ? { max_input_tokens: maxInputTokens } : {})
  });
  return String(response.text || '');
};

module.exports = {
  DEFAULT_MBART_MODEL,
  SERVICE_PATH,
  createMbartWorker,
  getMbartWorker,
  runMbart,
  stopMbartWorker
};
