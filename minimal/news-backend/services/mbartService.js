const path = require('path');
const { spawn } = require('child_process');

const SERVICE_PATH = path.join(__dirname, '..', 'mbart_service.py');

const runMbart = (
  { task, text, maxNewTokens, maxInputTokens } = {},
  { spawnImpl = spawn, env = process.env } = {}
) => new Promise((resolve, reject) => {
  const processHandle = spawnImpl('python3', [SERVICE_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...env,
      MBART_MODEL: env.MBART_MODEL || 'sagunrai/mbart-large-50-nepali-finetuned-1'
    }
  });

  let stdout = '';
  let stderr = '';
  let settled = false;

  processHandle.stdout.on('data', (data) => {
    stdout += data.toString('utf8');
  });
  processHandle.stderr.on('data', (data) => {
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

    try {
      const response = JSON.parse(stdout || '{}');
      if (!response.ok) {
        settled = true;
        reject(new Error(response.error || stderr || `mBART failed (exit ${code})`));
        return;
      }

      settled = true;
      resolve(response.text || '');
    } catch (error) {
      settled = true;
      reject(new Error(
        `Failed to parse mBART output. stderr=${stderr || '(none)'} stdout=${stdout || '(empty)'}`
      ));
    }
  });

  processHandle.stdin.write(JSON.stringify({
    task,
    text,
    ...(maxNewTokens ? { max_new_tokens: maxNewTokens } : {}),
    ...(maxInputTokens ? { max_input_tokens: maxInputTokens } : {})
  }));
  processHandle.stdin.end();
});

module.exports = {
  runMbart
};
