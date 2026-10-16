const crypto = require('node:crypto');

// Proveedor OTP simulado: el número no se guarda aquí, solo una referencia y el código.
class MockOtpProvider {
  constructor({ code, clock }) {
    this.code = code;
    this.clock = clock;
    this.sequence = 0;
  }

  sendCode() {
    this.sequence += 1;
    return { reference: `otp_${this.sequence}_${this.clock()}` };
  }

  verifyCode(submitted, expected = this.code) {
    const a = Buffer.from(String(submitted));
    const b = Buffer.from(String(expected));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

module.exports = { MockOtpProvider };
