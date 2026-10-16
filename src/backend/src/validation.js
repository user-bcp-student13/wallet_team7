const { ApiError } = require('./problem');

const PHONE_PATTERN = /^9\d{8}$/;
const OTP_PATTERN = /^\d{6}$/;

function fieldError(field, code, message) {
  return { field, code, message };
}

function checkUnexpectedFields(answers, allowed, errors) {
  const unexpected = Object.keys(answers).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    errors.push(fieldError('answers', 'UNEXPECTED_FIELD', 'Campo no permitido en la respuesta.'));
  }
}

const STEP_RULES = {
  phone(answers, errors) {
    checkUnexpectedFields(answers, ['phoneNumber', 'termsAccepted'], errors);
    if (answers.phoneNumber === undefined) {
      errors.push(fieldError('phoneNumber', 'REQUIRED', 'El celular es obligatorio.'));
    } else if (typeof answers.phoneNumber !== 'string' || !PHONE_PATTERN.test(answers.phoneNumber)) {
      errors.push(fieldError('phoneNumber', 'INVALID_FORMAT', 'El celular debe tener 9 dígitos y empezar con 9.'));
    }
    if (answers.termsAccepted === undefined) {
      errors.push(fieldError('termsAccepted', 'REQUIRED', 'Debes aceptar los términos.'));
    } else if (answers.termsAccepted !== true) {
      errors.push(fieldError('termsAccepted', 'INVALID_VALUE', 'Debes aceptar los términos.'));
    }
  },

  otp(answers, errors, policy) {
    checkUnexpectedFields(answers, ['otpCode'], errors);
    if (answers.otpCode === undefined) {
      errors.push(fieldError('otpCode', 'REQUIRED', 'El código es obligatorio.'));
    } else if (typeof answers.otpCode !== 'string' || !OTP_PATTERN.test(answers.otpCode)) {
      errors.push(fieldError('otpCode', 'INVALID_FORMAT', `El código debe tener ${policy.otp.length} dígitos.`));
    }
  },

  pin(answers, errors) {
    checkUnexpectedFields(answers, [], errors);
  },

  pinConfirmation(answers, errors) {
    checkUnexpectedFields(answers, ['pinSavedConfirmation'], errors);
    if (answers.pinSavedConfirmation === undefined) {
      errors.push(fieldError('pinSavedConfirmation', 'REQUIRED', 'Debes confirmar que guardaste tu PIN.'));
    } else if (answers.pinSavedConfirmation !== true) {
      errors.push(fieldError('pinSavedConfirmation', 'INVALID_VALUE', 'Debes confirmar que guardaste tu PIN.'));
    }
  },
};

// Valida el cuerpo de un paso. Devuelve los campos ya normalizados.
function validateStepAnswers(stepId, body, policy) {
  const errors = [];
  const answers = body && typeof body === 'object' && !Array.isArray(body) ? body.answers : undefined;

  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    errors.push(fieldError('answers', 'REQUIRED', 'El campo answers es obligatorio.'));
  } else {
    STEP_RULES[stepId](answers, errors, policy);
  }

  if (errors.length > 0) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Hay campos inválidos.', { errors });
  }
  return answers;
}

module.exports = { validateStepAnswers, PHONE_PATTERN, OTP_PATTERN };
