const crypto = require('node:crypto');
const { ApiError } = require('./problem');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function fingerprintOf(method, path, body) {
  const payload = JSON.stringify({ method, path, body: canonicalize(body ?? null) });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function encrypt(key, plain) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv, data, tag: cipher.getAuthTag() };
}

function decrypt(key, entry) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, entry.iv);
  decipher.setAuthTag(entry.tag);
  return Buffer.concat([decipher.update(entry.data), decipher.final()]).toString('utf8');
}

// Guarda solo respuestas 2xx, cifradas en memoria, con TTL configurable.
class IdempotencyStore {
  constructor({ key, ttlMinutes, clock }) {
    this.key = key;
    this.ttlMs = ttlMinutes * 60 * 1000;
    this.clock = clock;
    this.entries = new Map();
  }

  lookup(scope, fingerprint) {
    const entry = this.entries.get(scope);
    if (!entry) {
      return null;
    }
    if (this.clock() >= entry.expiresAt) {
      this.entries.delete(scope);
      return null;
    }
    if (entry.fingerprint !== fingerprint) {
      throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'La clave de idempotencia ya se usó con otro cuerpo.');
    }
    return JSON.parse(decrypt(this.key, entry.sealed));
  }

  store(scope, fingerprint, response) {
    this.entries.set(scope, {
      fingerprint,
      sealed: encrypt(this.key, JSON.stringify(response)),
      expiresAt: this.clock() + this.ttlMs,
    });
  }
}

module.exports = { IdempotencyStore, fingerprintOf };
