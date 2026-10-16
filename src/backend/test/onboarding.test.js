const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const TOKEN = 'token-de-prueba-0123456789';
const PHONE = '987654321';
const OTP = '123456';

let server;
let baseUrl;
let now;

before(async () => {
  const config = loadConfig({
    OTP_MOCK_CODE: OTP,
    IDEMPOTENCY_CACHE_KEY: crypto.randomBytes(32).toString('base64'),
  });
  const app = createApp({ config, clock: () => now });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  now = Date.parse('2025-01-01T12:00:00Z');
});

// Helpers ------------------------------------------------------------------

let keyCounter = 0;
function newKey() {
  keyCounter += 1;
  return `key-${keyCounter}-${crypto.randomUUID()}`;
}

async function call(method, path, { body, token = TOKEN, key } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['idempotency-key'] = key || newKey();
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function startAlta(token = TOKEN) {
  return call('POST', '/onboardings', { token });
}

function errorCodes(body) {
  return (body.errors || []).map((e) => e.code);
}

// Each test uses a fresh token so state is isolated per user.
function freshToken() {
  return `tok-${crypto.randomBytes(12).toString('hex')}`;
}

// Tests --------------------------------------------------------------------

test('flujo feliz completo termina en completed con walletStatus active', async () => {
  const token = freshToken();
  const start = await startAlta(token);
  assert.equal(start.status, 201);
  assert.equal(start.body.currentStepId, 'phone');
  assert.equal(start.body.countryCode, 'PE');
  assert.equal(start.body.limits.perTransferMaxPEN, 10);
  assert.equal(start.body.limits.dailyMaxTransfers, 5);
  assert.equal(start.body.limits.dailyMaxPEN, 50);

  const phone = await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: PHONE, termsAccepted: true } },
  });
  assert.equal(phone.status, 200);
  assert.equal(phone.body.currentStepId, 'otp');
  assert.equal(phone.body.phoneNumber, undefined, 'el número no se devuelve');

  const otp = await call('PUT', '/onboardings/current/steps/otp', {
    token,
    body: { answers: { otpCode: OTP } },
  });
  assert.equal(otp.status, 200);
  assert.equal(otp.body.currentStepId, 'pin');

  const pin = await call('PUT', '/onboardings/current/steps/pin', {
    token,
    body: { answers: {} },
  });
  assert.equal(pin.status, 200);
  assert.equal(pin.body.currentStepId, 'pinConfirmation');
  assert.match(pin.body.generatedPin, /^\d{6}$/);

  const done = await call('PUT', '/onboardings/current/steps/pinConfirmation', {
    token,
    body: { answers: { pinSavedConfirmation: true } },
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'completed');
  assert.equal(done.body.walletStatus, 'active');
});

test('sin token responde 401 UNAUTHORIZED', async () => {
  const res = await call('GET', '/onboardings/current', { token: null });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'UNAUTHORIZED');
});

test('token demasiado corto responde 401', async () => {
  const res = await call('GET', '/onboardings/current', { token: 'corto' });
  assert.equal(res.status, 401);
});

test('GET /onboardings/current sin alta responde 404', async () => {
  const res = await call('GET', '/onboardings/current', { token: freshToken() });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'ONBOARDING_NOT_FOUND');
});

test('ruta inexistente responde 404 NOT_FOUND en formato problem', async () => {
  const res = await call('GET', '/no-existe');
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
});

test('segundo alta en curso responde 409 ONBOARDING_ALREADY_IN_PROGRESS', async () => {
  const token = freshToken();
  assert.equal((await startAlta(token)).status, 201);
  const again = await startAlta(token);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'ONBOARDING_ALREADY_IN_PROGRESS');
});

test('idempotencia: misma clave y mismo cuerpo devuelve la misma respuesta', async () => {
  const token = freshToken();
  const key = newKey();
  const body = { answers: { phoneNumber: PHONE, termsAccepted: true } };
  await startAlta(token);
  const first = await call('PUT', '/onboardings/current/steps/phone', { token, key, body });
  const second = await call('PUT', '/onboardings/current/steps/phone', { token, key, body });
  assert.equal(first.status, 200);
  assert.deepEqual(second, first);
});

test('idempotencia: misma clave con otro cuerpo responde 409 IDEMPOTENCY_KEY_REUSED', async () => {
  const token = freshToken();
  const key = newKey();
  await startAlta(token);
  await call('PUT', '/onboardings/current/steps/phone', {
    token,
    key,
    body: { answers: { phoneNumber: PHONE, termsAccepted: true } },
  });
  const other = await call('PUT', '/onboardings/current/steps/phone', {
    token,
    key,
    body: { answers: { phoneNumber: '912345678', termsAccepted: true } },
  });
  assert.equal(other.status, 409);
  assert.equal(other.body.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('Idempotency-Key ausente o corto responde 400', async () => {
  const token = freshToken();
  const res = await fetch(baseUrl + '/onboardings', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'corta' },
  });
  assert.equal(res.status, 400);
});

test('campo extra en el cuerpo responde 422 UNEXPECTED_FIELD', async () => {
  const token = freshToken();
  await startAlta(token);
  const res = await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: PHONE, termsAccepted: true, extra: 'x' } },
  });
  assert.equal(res.status, 422);
  assert.ok(errorCodes(res.body).includes('UNEXPECTED_FIELD'));
});

test('teléfono inválido responde 422 con errors de campo', async () => {
  const token = freshToken();
  await startAlta(token);
  const res = await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: '812345678', termsAccepted: true } },
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.errors[0].field, 'phoneNumber');
});

test('términos no aceptados responde 422', async () => {
  const token = freshToken();
  await startAlta(token);
  const res = await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: PHONE, termsAccepted: false } },
  });
  assert.equal(res.status, 422);
});

test('paso fuera de orden responde 409 STEP_NOT_CURRENT', async () => {
  const token = freshToken();
  await startAlta(token);
  const res = await call('PUT', '/onboardings/current/steps/pin', {
    token,
    body: { answers: {} },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'STEP_NOT_CURRENT');
});

test('paso desconocido responde 404', async () => {
  const token = freshToken();
  await startAlta(token);
  const res = await call('PUT', '/onboardings/current/steps/inventado', {
    token,
    body: { answers: {} },
  });
  assert.equal(res.status, 404);
});

test('OTP incorrecto responde 422 OTP_INVALID con attemptsLeft', async () => {
  const token = freshToken();
  await startAlta(token);
  await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: PHONE, termsAccepted: true } },
  });
  const res = await call('PUT', '/onboardings/current/steps/otp', {
    token,
    body: { answers: { otpCode: '000000' } },
  });
  assert.equal(res.status, 422);
  assert.equal(errorCodes(res.body)[0], 'OTP_INVALID');
  assert.equal(res.body.attemptsLeft, 2);
});

test('tercer OTP incorrecto bloquea y responde OTP_ATTEMPTS_EXCEEDED con retryAfterSeconds', async () => {
  const token = freshToken();
  await startAlta(token);
  await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: PHONE, termsAccepted: true } },
  });
  for (let i = 0; i < 2; i += 1) {
    await call('PUT', '/onboardings/current/steps/otp', {
      token,
      body: { answers: { otpCode: '000000' } },
    });
  }
  const third = await call('PUT', '/onboardings/current/steps/otp', {
    token,
    body: { answers: { otpCode: '000000' } },
  });
  assert.equal(third.status, 422);
  assert.equal(errorCodes(third.body)[0], 'OTP_ATTEMPTS_EXCEEDED');
  assert.equal(third.body.retryAfterSeconds, 240);

  // Con código correcto, sigue bloqueado.
  const blocked = await call('PUT', '/onboardings/current/steps/otp', {
    token,
    body: { answers: { otpCode: OTP } },
  });
  assert.equal(blocked.status, 422);
  assert.equal(errorCodes(blocked.body)[0], 'OTP_ATTEMPTS_EXCEEDED');

  // Pasados 4 minutos, el bloqueo se libera. El código anterior ya venció,
  // así que hay que pedir uno nuevo.
  now += 4 * 60 * 1000 + 1;
  const resent = await call('POST', '/onboardings/current/otp/resend', { token });
  assert.equal(resent.status, 200);
  const after = await call('PUT', '/onboardings/current/steps/otp', {
    token,
    body: { answers: { otpCode: OTP } },
  });
  assert.equal(after.status, 200);
  assert.equal(after.body.currentStepId, 'pin');
});

test('OTP vencido a los 60 segundos responde OTP_EXPIRED', async () => {
  const token = freshToken();
  await startAlta(token);
  await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: PHONE, termsAccepted: true } },
  });
  now += 60 * 1000;
  const res = await call('PUT', '/onboardings/current/steps/otp', {
    token,
    body: { answers: { otpCode: OTP } },
  });
  assert.equal(res.status, 422);
  assert.equal(errorCodes(res.body)[0], 'OTP_EXPIRED');
});

test('reenvío de OTP reinicia el vencimiento y se limita a 3', async () => {
  const token = freshToken();
  await startAlta(token);
  await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: PHONE, termsAccepted: true } },
  });
  for (let i = 0; i < 3; i += 1) {
    now += 30 * 1000;
    const r = await call('POST', '/onboardings/current/otp/resend', { token });
    assert.equal(r.status, 200);
  }
  const over = await call('POST', '/onboardings/current/otp/resend', { token });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, 'OTP_RESEND_LIMIT_REACHED');
});

test('reenvío fuera del paso otp responde 409 STEP_NOT_CURRENT', async () => {
  const token = freshToken();
  await startAlta(token);
  const res = await call('POST', '/onboardings/current/otp/resend', { token });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'STEP_NOT_CURRENT');
});

test('cambio de número durante otp reenvía OTP y cuenta contra el límite', async () => {
  const token = freshToken();
  await startAlta(token);
  await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: PHONE, termsAccepted: true } },
  });
  const changed = await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: '912345678', termsAccepted: true } },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.currentStepId, 'otp');
  assert.equal(changed.body.otp.attemptsLeft, 3);
  assert.equal(changed.body.otp.resendsLeft, 2);
});

test('PIN generado tiene 6 dígitos y no es débil', async () => {
  const token = freshToken();
  await startAlta(token);
  await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: PHONE, termsAccepted: true } },
  });
  await call('PUT', '/onboardings/current/steps/otp', {
    token,
    body: { answers: { otpCode: OTP } },
  });
  const pin = await call('PUT', '/onboardings/current/steps/pin', {
    token,
    body: { answers: {} },
  });
  assert.match(pin.body.generatedPin, /^\d{6}$/);
  assert.notEqual(new Set(pin.body.generatedPin).size, 1);
});

test('regeneración del PIN se limita a 2 y devuelve un PIN nuevo', async () => {
  const token = freshToken();
  await startAlta(token);
  await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: PHONE, termsAccepted: true } },
  });
  await call('PUT', '/onboardings/current/steps/otp', {
    token,
    body: { answers: { otpCode: OTP } },
  });
  const first = await call('PUT', '/onboardings/current/steps/pin', {
    token,
    body: { answers: {} },
  });
  const r1 = await call('POST', '/onboardings/current/pin/regenerate', { token });
  const r2 = await call('POST', '/onboardings/current/pin/regenerate', { token });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.pinRegenerationsLeft, 0);
  assert.match(r1.body.generatedPin, /^\d{6}$/);
  assert.notEqual(r1.body.generatedPin, first.body.generatedPin);
  const third = await call('POST', '/onboardings/current/pin/regenerate', { token });
  assert.equal(third.status, 409);
  assert.equal(third.body.code, 'PIN_REGENERATION_LIMIT_REACHED');
});

test('regenerar PIN fuera de pinConfirmation responde 409', async () => {
  const token = freshToken();
  await startAlta(token);
  const res = await call('POST', '/onboardings/current/pin/regenerate', { token });
  assert.equal(res.status, 409);
});

test('cierre del alta y alta nueva tras completed', async () => {
  const token = freshToken();
  await startAlta(token);
  await call('PUT', '/onboardings/current/steps/phone', {
    token,
    body: { answers: { phoneNumber: PHONE, termsAccepted: true } },
  });
  await call('PUT', '/onboardings/current/steps/otp', {
    token,
    body: { answers: { otpCode: OTP } },
  });
  await call('PUT', '/onboardings/current/steps/pin', { token, body: { answers: {} } });
  const done = await call('PUT', '/onboardings/current/steps/pinConfirmation', {
    token,
    body: { answers: { pinSavedConfirmation: true } },
  });
  assert.equal(done.body.status, 'completed');

  const closed = await call('POST', '/onboardings/current/close', { token });
  assert.equal(closed.status, 409);
  assert.equal(closed.body.code, 'ONBOARDING_CLOSED');

  const restart = await startAlta(token);
  assert.equal(restart.status, 201);
  assert.equal(restart.body.currentStepId, 'phone');
});

test('cierre de un alta en curso responde 200 con status closed', async () => {
  const token = freshToken();
  await startAlta(token);
  const res = await call('POST', '/onboardings/current/close', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'closed');
  assert.ok(res.body.closedAt);
});

test('GET refleja el paso actual y los límites', async () => {
  const token = freshToken();
  await startAlta(token);
  const res = await call('GET', '/onboardings/current', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.currentStepId, 'phone');
  assert.equal(res.body.limits.currency, 'PEN');
  assert.equal(res.body.steps.length, 4);
});
