const crypto = require('node:crypto');
const { ApiError } = require('./problem');
const { generatePin, hashPin } = require('./pin');
const { validateStepAnswers } = require('./validation');

const STEPS = [
  { id: 'phone', title: 'Tu número de celular' },
  { id: 'otp', title: 'Ingresa el código' },
  { id: 'pin', title: 'Tu PIN de 6 dígitos' },
  { id: 'pinConfirmation', title: 'Confirma tu PIN' },
];
const STEP_IDS = new Set(STEPS.map((step) => step.id));

const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
const newId = () => `onb_${crypto.randomBytes(8).toString('hex')}`;

function otpError(code, message, extra) {
  return new ApiError(422, 'VALIDATION_FAILED', message, {
    errors: [{ field: 'otpCode', code, message }],
    extra,
  });
}

const closedError = () =>
  new ApiError(409, 'ONBOARDING_CLOSED', 'El alta ya está cerrada o completada.');

const stepNotCurrentError = () =>
  new ApiError(409, 'STEP_NOT_CURRENT', 'El paso no es el actual.');

// Estado en memoria por usuario. El número de celular se guarda solo para el flujo; nunca se devuelve.
class OnboardingService {
  constructor({ config, otpProvider, clock }) {
    this.limits = config.limits;
    this.policy = config.policy;
    this.otpProvider = otpProvider;
    this.clock = clock;
    this.records = new Map();
  }

  start(userId) {
    const existing = this.records.get(userId);
    if (existing && existing.status === 'in_progress') {
      throw new ApiError(409, 'ONBOARDING_ALREADY_IN_PROGRESS', 'Ya tienes un alta en curso.', {
        extra: { onboardingId: existing.id },
      });
    }
    const now = this.clock();
    const record = {
      id: newId(),
      status: 'in_progress',
      walletStatus: 'pending',
      currentStepId: 'phone',
      stepCompletedAt: {},
      startedAt: now,
      completedAt: null,
      closedAt: null,
      updatedAt: now,
      phoneNumber: null,
      otp: null,
      otpResends: 0,
      pinHash: null,
      pinRegenerations: 0,
    };
    this.records.set(userId, record);
    return this.view(record);
  }

  get(userId) {
    return this.view(this.current(userId));
  }

  submitStep(userId, stepId, body) {
    const record = this.open(userId);
    if (!STEP_IDS.has(stepId)) {
      throw new ApiError(404, 'ONBOARDING_NOT_FOUND', 'El paso no pertenece al flujo.');
    }
    const changingNumber = stepId === 'phone' && record.currentStepId === 'otp';
    if (stepId !== record.currentStepId && !changingNumber) {
      throw stepNotCurrentError();
    }
    const answers = validateStepAnswers(stepId, body, this.policy);

    if (changingNumber) {
      return this.changePhone(record, answers.phoneNumber);
    }
    switch (stepId) {
      case 'phone':
        return this.submitPhone(record, answers.phoneNumber);
      case 'otp':
        return this.submitOtp(record, answers.otpCode);
      case 'pin':
        return this.generateInitialPin(record);
      default:
        return this.confirmPin(record);
    }
  }

  resendOtp(userId) {
    const record = this.open(userId);
    if (record.currentStepId !== 'otp') {
      throw stepNotCurrentError();
    }
    this.releaseBlockIfExpired(record);
    if (record.otp.blockedUntil !== null) {
      throw this.blockedError(record);
    }
    this.consumeResend(record);
    record.otp = this.issueOtp();
    record.updatedAt = this.clock();
    return this.view(record);
  }

  close(userId) {
    const record = this.open(userId);
    const now = this.clock();
    record.status = 'closed';
    record.closedAt = now;
    record.updatedAt = now;
    return this.view(record);
  }

  regeneratePin(userId) {
    const record = this.open(userId);
    if (record.currentStepId !== 'pinConfirmation') {
      throw stepNotCurrentError();
    }
    if (record.pinRegenerations >= this.policy.pin.maxRegenerations) {
      throw new ApiError(409, 'PIN_REGENERATION_LIMIT_REACHED', 'Alcanzaste el máximo de regeneraciones del PIN.');
    }
    const pin = this.issuePin(record);
    record.pinRegenerations += 1;
    record.updatedAt = this.clock();
    return this.view(record, { generatedPin: pin });
  }

  current(userId) {
    const record = this.records.get(userId);
    if (!record) {
      throw new ApiError(404, 'ONBOARDING_NOT_FOUND', 'No hay un alta activa.');
    }
    return record;
  }

  open(userId) {
    const record = this.current(userId);
    if (record.status !== 'in_progress') {
      throw closedError();
    }
    return record;
  }

  submitPhone(record, phoneNumber) {
    record.phoneNumber = phoneNumber;
    this.complete(record, 'phone');
    record.otp = this.issueOtp();
    return this.view(record);
  }

  changePhone(record, phoneNumber) {
    this.releaseBlockIfExpired(record);
    if (record.otp.blockedUntil !== null) {
      throw this.blockedError(record);
    }
    this.consumeResend(record);
    record.phoneNumber = phoneNumber;
    record.otp = this.issueOtp();
    record.updatedAt = this.clock();
    return this.view(record);
  }

  submitOtp(record, code) {
    const now = this.clock();
    this.releaseBlockIfExpired(record);
    const otp = record.otp;
    if (otp.blockedUntil !== null) {
      throw this.blockedError(record);
    }
    if (now >= otp.expiresAt) {
      throw otpError('OTP_EXPIRED', 'El código venció. Pide uno nuevo.');
    }
    if (!this.otpProvider.verifyCode(code)) {
      otp.attempts += 1;
      if (otp.attempts >= this.policy.otp.maxAttempts) {
        otp.blockedUntil = now + this.policy.otp.blockMinutes * 60 * 1000;
        otp.attempts = 0;
        throw this.blockedError(record);
      }
      throw otpError('OTP_INVALID', 'El código es incorrecto.', {
        attemptsLeft: this.policy.otp.maxAttempts - otp.attempts,
      });
    }
    record.otp = null;
    this.complete(record, 'otp');
    return this.view(record);
  }

  generateInitialPin(record) {
    const pin = this.issuePin(record);
    this.complete(record, 'pin');
    return this.view(record, { generatedPin: pin });
  }

  confirmPin(record) {
    const now = this.clock();
    this.complete(record, 'pinConfirmation');
    record.status = 'completed';
    record.walletStatus = 'active';
    record.completedAt = now;
    record.updatedAt = now;
    return this.view(record);
  }

  issuePin(record) {
    const pin = generatePin(this.policy.pin.length);
    record.pinHash = hashPin(pin);
    return pin;
  }

  issueOtp() {
    this.otpProvider.sendCode();
    return {
      expiresAt: this.clock() + this.policy.otp.ttlSeconds * 1000,
      attempts: 0,
      blockedUntil: null,
    };
  }

  consumeResend(record) {
    if (record.otpResends >= this.policy.otp.maxResends) {
      throw new ApiError(409, 'OTP_RESEND_LIMIT_REACHED', 'Alcanzaste el máximo de reenvíos.');
    }
    record.otpResends += 1;
  }

  releaseBlockIfExpired(record) {
    const otp = record.otp;
    if (otp && otp.blockedUntil !== null && this.clock() >= otp.blockedUntil) {
      otp.blockedUntil = null;
      otp.attempts = 0;
    }
  }

  blockedError(record) {
    const retryAfterSeconds = Math.ceil((record.otp.blockedUntil - this.clock()) / 1000);
    return otpError('OTP_ATTEMPTS_EXCEEDED', 'Demasiados intentos. Espera antes de volver a intentar.', {
      retryAfterSeconds,
    });
  }

  complete(record, stepId) {
    const now = this.clock();
    const index = STEPS.findIndex((step) => step.id === stepId);
    record.stepCompletedAt[stepId] = now;
    record.currentStepId = STEPS[index + 1] ? STEPS[index + 1].id : null;
    record.updatedAt = now;
  }

  view(record, extra = {}) {
    const { limits } = this;
    const body = {
      id: record.id,
      status: record.status,
      walletStatus: record.walletStatus,
      countryCode: limits.countryCode,
      steps: STEPS.map((step, index) => {
        const completedAt = record.stepCompletedAt[step.id] ?? null;
        let status = 'pending';
        if (completedAt !== null) {
          status = 'completed';
        } else if (step.id === record.currentStepId) {
          status = 'current';
        }
        return { id: step.id, title: step.title, order: index + 1, status, completedAt: iso(completedAt) };
      }),
      currentStepId: record.currentStepId,
      startedAt: iso(record.startedAt),
      completedAt: iso(record.completedAt),
      closedAt: iso(record.closedAt),
      updatedAt: iso(record.updatedAt),
      limits: {
        perTransferMaxPEN: limits.perTransferMaxPEN,
        dailyMaxTransfers: limits.dailyMaxTransfers,
        currency: limits.currency,
        dailyMaxPEN: limits.dailyMaxPEN,
      },
    };

    if (record.currentStepId === 'otp' && record.otp) {
      this.releaseBlockIfExpired(record);
      body.otp = {
        attemptsLeft: this.policy.otp.maxAttempts - record.otp.attempts,
        resendsLeft: this.policy.otp.maxResends - record.otpResends,
        expiresAt: iso(record.otp.expiresAt),
        blockedUntil: iso(record.otp.blockedUntil),
      };
    }
    if (record.pinHash && record.status === 'in_progress') {
      body.pinRegenerationsLeft = this.policy.pin.maxRegenerations - record.pinRegenerations;
    }
    return { ...body, ...extra };
  }
}

module.exports = { OnboardingService, STEPS };
