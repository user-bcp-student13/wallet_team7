const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const OTP_MOCK_CODE_PATTERN = /^\d{6}$/;
const IDEMPOTENCY_KEY_BYTES = 32;

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, fileName), 'utf8'));
}

function resolveIdempotencyKey(encoded) {
  if (!encoded) {
    return crypto.randomBytes(IDEMPOTENCY_KEY_BYTES);
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== IDEMPOTENCY_KEY_BYTES) {
    throw new Error('IDEMPOTENCY_CACHE_KEY debe ser 32 bytes en base64.');
  }
  return key;
}

function resolveOtpMockCode(value) {
  const code = value || '123456';
  if (!OTP_MOCK_CODE_PATTERN.test(code)) {
    throw new Error('OTP_MOCK_CODE debe tener 6 dígitos.');
  }
  return code;
}

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    limits: readJson('limits.mock.json'),
    policy: readJson('onboarding-policy.json'),
    otpMockCode: resolveOtpMockCode(env.OTP_MOCK_CODE),
    idempotencyKey: resolveIdempotencyKey(env.IDEMPOTENCY_CACHE_KEY),
  };
}

module.exports = { loadConfig };
