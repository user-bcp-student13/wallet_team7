const crypto = require('node:crypto');

const SCRYPT_KEY_LENGTH = 32;
const SALT_BYTES = 16;

// Un PIN es débil si todos sus dígitos son iguales o forman una secuencia ascendente o descendente.
function isWeakPin(pin) {
  const digits = [...pin].map(Number);
  const allEqual = digits.every((d) => d === digits[0]);
  const step = digits[1] - digits[0];
  const sequential =
    Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1] === step);
  return allEqual || sequential;
}

function generatePin(length) {
  let pin;
  do {
    pin = Array.from({ length }, () => crypto.randomInt(0, 10)).join('');
  } while (isWeakPin(pin));
  return pin;
}

function hashPin(pin) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(pin, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPin(pin, stored) {
  const [, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(pin, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { generatePin, hashPin, verifyPin, isWeakPin };
