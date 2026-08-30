const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { hasDevanagari } = require('./languageService');

const BACKEND_ROOT = path.join(__dirname, '..');
const AUDIO_DIRECTORY = path.join(BACKEND_ROOT, 'public', 'audio');
const TTS_SCRIPT = path.join(BACKEND_ROOT, 'tts_service.py');

const cleanTtsText = (text, maxChars = 2000) => (
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

const synthesizeAudio = ({
  text,
  fileName,
  nepali = hasDevanagari(text),
  maxChars = 2000,
  fsImpl = fs,
  spawnImpl = spawn
}) => {
  const cleanText = cleanTtsText(text, maxChars);
  if (!cleanText) {
    return Promise.reject(new Error('Cannot synthesize empty text'));
  }

  const target = getAudioTarget(fileName);
  fsImpl.mkdirSync(AUDIO_DIRECTORY, { recursive: true });

  return new Promise((resolve, reject) => {
    const processHandle = spawnImpl('python3', [
      TTS_SCRIPT,
      cleanText,
      target.outputPath,
      voiceModelPath(nepali)
    ]);

    let stderr = '';
    let settled = false;
    processHandle.stderr?.on('data', (data) => {
      stderr += data.toString('utf8');
    });

    processHandle.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    processHandle.on('close', (code) => {
      if (settled) return;
      settled = true;

      if (code === 0) {
        resolve(target);
        return;
      }

      reject(new Error(stderr.trim() || `TTS generation failed (exit ${code})`));
    });
  });
};

module.exports = {
  AUDIO_DIRECTORY,
  audioExists,
  cleanTtsText,
  getAudioTarget,
  synthesizeAudio,
  voiceModelPath
};
