const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { hasDevanagari } = require('./languageService');
const { PythonWorker } = require('./pythonWorker');

const BACKEND_ROOT = path.join(__dirname, '..');
const AUDIO_DIRECTORY = path.join(BACKEND_ROOT, 'public', 'audio');
const TTS_SCRIPT = path.join(BACKEND_ROOT, 'tts_service.py');
const MAX_TTS_CHARS = 2000;
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const cleanTtsText = (text, maxChars = MAX_TTS_CHARS) => (
  String(text || '')
    .trim()
    .slice(0, maxChars)
    .replace(/[*#\-_`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const voiceModelPath = (nepali) => path.join(
  BACKEND_ROOT,
  'models',
  nepali ? 'ne_NP-google-medium.onnx' : 'en_US-lessac-medium.onnx'
);

const getAudioTarget = (fileName) => {
  const safeName = String(fileName || '');
  if (!safeName || path.basename(safeName) !== safeName || !safeName.endsWith('.wav')) {
    throw new Error('Invalid audio file name');
  }

  return {
    audioUrl: `/audio/${safeName}`,
    outputPath: path.join(AUDIO_DIRECTORY, safeName)
  };
};

const audioExists = (fileName, fsImpl = fs) => (
  fsImpl.existsSync(getAudioTarget(fileName).outputPath)
);

// Audio files are named after a hash of the voice and the exact text spoken,
// so identical requests reuse one file and an edited summary never replays
// stale audio.
const audioCacheKey = (text, nepali, maxChars = MAX_TTS_CHARS) => crypto
  .createHash('sha256')
  .update(`${nepali ? 'ne' : 'en'}\n${cleanTtsText(text, maxChars)}`)
  .digest('hex');

const articleAudioFileName = (articleId, text, nepali) => (
  `${String(articleId)}-${audioCacheKey(text, nepali).slice(0, 12)}.wav`
);

const textAudioFileName = (text, nepali) => (
  `tts_${audioCacheKey(text, nepali).slice(0, 32)}.wav`
);

let sharedWorker = null;

const getTtsWorker = () => {
  if (!sharedWorker) {
    sharedWorker = new PythonWorker({
      name: 'TTS worker',
      scriptPath: TTS_SCRIPT,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      requestTimeoutMs: positiveInt(process.env.TTS_TIMEOUT_MS, 2 * 60 * 1000),
      idleTimeoutMs: positiveInt(process.env.TTS_IDLE_TIMEOUT_MS, 10 * 60 * 1000),
      maxQueue: positiveInt(process.env.TTS_MAX_QUEUE, 16)
    });
  }
  return sharedWorker;
};

const stopTtsWorker = () => {
  if (sharedWorker) sharedWorker.stop();
  sharedWorker = null;
};

const synthesizeAudio = async ({
  text,
  fileName,
  nepali = hasDevanagari(text),
  maxChars = MAX_TTS_CHARS,
  fsImpl = fs,
  worker
}) => {
  const cleanText = cleanTtsText(text, maxChars);
  if (!cleanText) {
    throw new Error('Cannot synthesize empty text');
  }

  const target = getAudioTarget(fileName);
  fsImpl.mkdirSync(AUDIO_DIRECTORY, { recursive: true });

  // Write to a temporary file and rename, so a client never streams a
  // half-written WAV while synthesis is still running.
  const tempPath = `${target.outputPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await (worker || getTtsWorker()).request({
      text: cleanText,
      output_path: tempPath,
      model_path: voiceModelPath(nepali)
    });
    fsImpl.renameSync(tempPath, target.outputPath);
  } catch (error) {
    try {
      fsImpl.rmSync?.(tempPath, { force: true });
    } catch {
      // best effort cleanup
    }
    throw error;
  }

  return target;
};

const inFlight = new Map();

// Return the cached file when present; otherwise synthesize once even when
// several requests for the same audio arrive together.
const getOrCreateAudio = ({ text, fileName, nepali, fsImpl = fs, worker } = {}) => {
  const target = getAudioTarget(fileName);
  if (fsImpl.existsSync(target.outputPath)) {
    return Promise.resolve({ ...target, cached: true });
  }
  if (inFlight.has(fileName)) return inFlight.get(fileName);

  const job = synthesizeAudio({ text, fileName, nepali, fsImpl, worker })
    .finally(() => inFlight.delete(fileName));
  inFlight.set(fileName, job);
  return job;
};

const pruneAudioCache = ({
  directory = AUDIO_DIRECTORY,
  maxAgeMs = positiveInt(process.env.TTS_CACHE_MAX_AGE_DAYS, 14) * 24 * 60 * 60 * 1000,
  maxFiles = positiveInt(process.env.TTS_CACHE_MAX_FILES, 500),
  fsImpl = fs,
  now = Date.now()
} = {}) => {
  let names;
  try {
    names = fsImpl.readdirSync(directory);
  } catch {
    return { removed: 0, kept: 0 };
  }

  const stat = (name) => {
    const filePath = path.join(directory, name);
    try {
      return { name, filePath, mtimeMs: fsImpl.statSync(filePath).mtimeMs };
    } catch {
      return null;
    }
  };
  const remove = (file) => {
    try {
      fsImpl.unlinkSync(file.filePath);
      return true;
    } catch {
      return false;
    }
  };

  let removedAudio = 0;
  const audioFiles = names.filter((name) => name.endsWith('.wav')).map(stat).filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  audioFiles.forEach((file, index) => {
    if ((index >= maxFiles || now - file.mtimeMs > maxAgeMs) && remove(file)) removedAudio += 1;
  });

  // Leftovers from interrupted syntheses.
  let removedTemp = 0;
  names.filter((name) => name.endsWith('.tmp')).map(stat).filter(Boolean)
    .forEach((file) => {
      if (now - file.mtimeMs > TEMP_FILE_MAX_AGE_MS && remove(file)) removedTemp += 1;
    });

  return { removed: removedAudio + removedTemp, kept: audioFiles.length - removedAudio };
};

module.exports = {
  AUDIO_DIRECTORY,
  MAX_TTS_CHARS,
  articleAudioFileName,
  audioCacheKey,
  audioExists,
  cleanTtsText,
  getAudioTarget,
  getOrCreateAudio,
  getTtsWorker,
  pruneAudioCache,
  stopTtsWorker,
  synthesizeAudio,
  textAudioFileName,
  voiceModelPath
};
