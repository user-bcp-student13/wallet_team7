const path = require('node:path');
const express = require('express');
const { buildRouter } = require('./routes');
const { OnboardingService } = require('./onboarding-service');
const { MockOtpProvider } = require('./otp-provider');
const { IdempotencyStore } = require('./idempotency');
const { errorHandler, notFoundHandler } = require('./problem');

const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');

function createApp({ config, clock = Date.now, otpProvider }) {
  const provider =
    otpProvider ?? new MockOtpProvider({ code: config.otpMockCode, clock });
  const service = new OnboardingService({ config, otpProvider: provider, clock });
  const store = new IdempotencyStore({
    key: config.idempotencyKey,
    ttlMinutes: config.policy.idempotency.ttlMinutes,
    clock,
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4kb' }));
  app.use(express.static(FRONTEND_DIR));
  app.use('/api/v1', buildRouter({ service, store, policy: config.policy }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
