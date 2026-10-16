const express = require('express');
const { ApiError } = require('./problem');
const { requireAuth } = require('./auth');
const { fingerprintOf } = require('./idempotency');

const KEY_HEADER = 'Idempotency-Key';

function readIdempotencyKey(req, policy) {
  const key = req.get(KEY_HEADER);
  const { keyMinLength, keyMaxLength } = policy.idempotency;
  if (!key || key.length < keyMinLength || key.length > keyMaxLength) {
    throw new ApiError(400, 'BAD_REQUEST', `Falta el header ${KEY_HEADER} o su formato es inválido.`);
  }
  return key;
}

// Ejecuta la acción una sola vez por (usuario, clave). Solo se cachean respuestas 2xx.
function idempotent(store, policy, action) {
  return async (req, res) => {
    const key = readIdempotencyKey(req, policy);
    const scope = `${req.userId}:${key}`;
    const body = req.body ?? {};
    const fingerprint = fingerprintOf(req.method, req.path, body);

    const cached = store.lookup(scope, fingerprint);
    if (cached) {
      res.status(cached.status).json(cached.body);
      return;
    }

    const { status, body: responseBody } = action(req, body);
    store.store(scope, fingerprint, { status, body: responseBody });
    res.status(status).json(responseBody);
  };
}

function buildRouter({ service, store, policy }) {
  const router = express.Router();
  router.use(requireAuth);

  router.post(
    '/onboardings',
    idempotent(store, policy, (req) => ({ status: 201, body: service.start(req.userId) })),
  );

  router.get('/onboardings/current', (req, res) => {
    res.json(service.get(req.userId));
  });

  router.put(
    '/onboardings/current/steps/:stepId',
    idempotent(store, policy, (req, body) => ({
      status: 200,
      body: service.submitStep(req.userId, req.params.stepId, body),
    })),
  );

  router.post(
    '/onboardings/current/close',
    idempotent(store, policy, (req) => ({ status: 200, body: service.close(req.userId) })),
  );

  router.post(
    '/onboardings/current/otp/resend',
    idempotent(store, policy, (req) => ({ status: 200, body: service.resendOtp(req.userId) })),
  );

  router.post(
    '/onboardings/current/pin/regenerate',
    idempotent(store, policy, (req) => ({ status: 200, body: service.regeneratePin(req.userId) })),
  );

  return router;
}

module.exports = { buildRouter, readIdempotencyKey };
