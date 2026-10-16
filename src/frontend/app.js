(() => {
  'use strict';

  const API = '/api/v1';
  const OTP_LENGTH = 6;
  const PIN_LENGTH = 6;
  const RESEND_WAIT_SECONDS = 30;
  const TOKEN_KEY = 'wallet7.token';

  const $ = (id) => document.getElementById(id);
  const app = $('app');

  let phoneNumber = null;
  let otpExpiresAt = null;
  let otpTimer = null;
  let resendTimer = null;
  let resendAvailableAt = 0;
  let lastPin = null;
  let pinRegenerationsLeft = null;

  function getToken() {
    let token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      sessionStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  }

  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  async function api(method, path, body, { idempotent = false } = {}) {
    const headers = { Authorization: 'Bearer ' + getToken() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotent) headers['Idempotency-Key'] = crypto.randomUUID();

    const res = await fetch(API + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.detail) || 'Ocurrió un error. Intenta de nuevo.');
      err.status = res.status;
      err.problem = data || {};
      throw err;
    }
    return data;
  }

  function showView(id) {
    document.querySelectorAll('.view').forEach((v) => {
      v.hidden = v.id !== id;
    });
  }

  function setBusy(isBusy) {
    app.classList.toggle('busy', isBusy);
  }

  function setError(el, message) {
    el.textContent = message || '';
    el.hidden = !message;
  }

  function maskedPhoneText() {
    return phoneNumber ? '9** *** ' + phoneNumber.slice(6) : 'tu celular';
  }

  function firstError(err) {
    const errors = err.problem && err.problem.errors;
    return errors && errors.length ? errors[0] : null;
  }

  function apiMessage(err) {
    return (err.problem && err.problem.detail) || err.message;
  }

  function resetSession() {
    clearTimers();
    clearToken();
    phoneNumber = null;
    otpExpiresAt = null;
    lastPin = null;
    pinRegenerationsLeft = null;
    $('phone').value = '';
    $('terms').checked = false;
    $('phoneError').hidden = true;
    $('btnPhone').disabled = true;
  }

  function clearTimers() {
    clearInterval(otpTimer);
    clearInterval(resendTimer);
    otpTimer = null;
    resendTimer = null;
  }

  function showGlobalError(message) {
    setError($('globalError'), message);
  }

  function renderOtpInputs() {
    const row = $('otpRow');
    row.innerHTML = '';
    for (let i = 0; i < OTP_LENGTH; i++) {
      const input = document.createElement('input');
      input.className = 'otp';
      input.maxLength = 1;
      input.inputMode = 'numeric';
      input.autocomplete = i === 0 ? 'one-time-code' : 'off';
      input.setAttribute('aria-label', 'Dígito ' + (i + 1));
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 1);
        if (input.value && i < OTP_LENGTH - 1) row.children[i + 1].focus();
        updateOtpButton();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && i > 0) row.children[i - 1].focus();
      });
      input.addEventListener('paste', (e) => {
        const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, OTP_LENGTH);
        if (!text) return;
        e.preventDefault();
        [...text].forEach((ch, idx) => { row.children[idx].value = ch; });
        row.children[Math.min(text.length, OTP_LENGTH - 1)].focus();
        updateOtpButton();
      });
      row.appendChild(input);
    }
  }

  function otpCode() {
    return Array.from($('otpRow').children).map((i) => i.value).join('');
  }

  function setOtpDisabled(disabled) {
    $('otpRow').dataset.locked = disabled ? '1' : '';
    Array.from($('otpRow').children).forEach((i) => { i.disabled = disabled; });
  }

  function clearOtpInputs() {
    Array.from($('otpRow').children).forEach((i) => { i.value = ''; });
  }

  function updateOtpButton() {
    const locked = $('otpRow').dataset.locked === '1';
    $('btnOtp').disabled = locked || otpCode().length !== OTP_LENGTH;
  }

  function updatePhoneButton() {
    const valid = /^9\d{8}$/.test($('phone').value) && $('terms').checked;
    $('btnPhone').disabled = !valid;
  }

  function startOtpCountdown(expiresAtIso) {
    clearInterval(otpTimer);
    otpExpiresAt = expiresAtIso ? new Date(expiresAtIso).getTime() : null;
    if (!otpExpiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000));
      $('otpInfo').textContent = left > 0
        ? 'El código vence en ' + left + ' s.'
        : 'El código venció. Pide uno nuevo.';
      if (left === 0) {
        clearInterval(otpTimer);
        setOtpDisabled(true);
        updateOtpButton();
      }
    };
    tick();
    otpTimer = setInterval(tick, 1000);
  }

  function startResendCooldown(seconds = RESEND_WAIT_SECONDS) {
    clearInterval(resendTimer);
    resendAvailableAt = Date.now() + seconds * 1000;
    const timer = $('resend').querySelector('#timer') || $('resend');
    const tick = () => {
      const left = Math.ceil((resendAvailableAt - Date.now()) / 1000);
      if (left > 0) {
        $('resend').disabled = true;
        timer.textContent = ' (' + left + ' s)';
      } else {
        clearInterval(resendTimer);
        $('resend').disabled = false;
        timer.textContent = '';
        if ($('otpRow').dataset.blocked === '1') {
          delete $('otpRow').dataset.blocked;
          setOtpDisabled(false);
          clearOtpInputs();
          setError($('otpError'), '');
          updateOtpButton();
        }
      }
    };
    tick();
    resendTimer = setInterval(tick, 1000);
  }

  function renderPinDisplay(pin, visible) {
    const display = $('pinDisplay');
    display.innerHTML = '';
    for (let i = 0; i < PIN_LENGTH; i++) {
      const span = document.createElement('span');
      span.className = 'pin-digit';
      span.textContent = pin && visible ? pin[i] : '•';
      display.appendChild(span);
    }
  }

  function applyPinState(data) {
    if (typeof data.pinRegenerationsLeft === 'number') {
      pinRegenerationsLeft = data.pinRegenerationsLeft;
    }
    $('btnRegenerate').disabled = pinRegenerationsLeft !== null && pinRegenerationsLeft <= 0;
    $('btnRegenerate').textContent = pinRegenerationsLeft !== null
      ? 'Generar otro PIN (' + pinRegenerationsLeft + ' restantes)'
      : 'Generar otro PIN';
  }

  function renderWelcome() {
    showView('v-welcome');
  }

  function renderPhone() {
    showView('v-phone');
    updatePhoneButton();
  }

  function renderOtp(data) {
    showView('v-otp');
    $('maskedPhone').textContent = maskedPhoneText();
    $('otpInfo').textContent = '';
    setError($('otpError'), '');
    renderOtpInputs();
    clearOtpInputs();
    const otp = data.otp || {};
    if (otp.blockedUntil) {
      $('otpRow').dataset.blocked = '1';
      setOtpDisabled(true);
      const seconds = Math.max(1, Math.ceil((new Date(otp.blockedUntil).getTime() - Date.now()) / 1000));
      setError($('otpError'), 'Demasiados intentos. Espera ' + seconds + ' s antes de volver a intentar.');
      updateOtpButton();
      startResendCooldown(seconds);
      return;
    }
    delete $('otpRow').dataset.blocked;
    setOtpDisabled(false);
    startOtpCountdown(otp.expiresAt);
    updateOtpButton();
    startResendCooldown();
  }

  function renderPin(data) {
    showView('v-pin');
    setError($('pinError'), '');
    $('pinSaved').checked = false;
    $('btnPin').disabled = true;
    $('pinInfo').textContent = 'Este es tu PIN de 6 dígitos. Guárdalo; no podrás verlo después.';
    $('btnShowPin').textContent = 'Mostrar';
    renderPinDisplay(lastPin, false);
    applyPinState(data);
    if (!lastPin) {
      $('pinInfo').textContent = 'Tu PIN ya no se puede mostrar. Genera uno nuevo para continuar.';
    }
  }

  function renderDone(data) {
    showView('v-done');
    const limits = (data && data.limits) || {};
    $('limitPerTransfer').textContent = 'S/ ' + (limits.perTransferMaxPEN ?? 10);
    $('limitDaily').textContent = String(limits.dailyMaxTransfers ?? 5);
  }

  function renderLoading(message) {
    showView('v-loading');
    $('loadingMsg').textContent = message || 'Cargando…';
    $('globalError').hidden = true;
  }

  function renderLoadError(message) {
    showView('v-loading');
    $('loadingMsg').textContent = '';
    showGlobalError(message || 'No pudimos cargar tu alta. Intenta de nuevo.');
  }

  function routeByStep(data) {
    if (!data) return renderWelcome();
    if (data.status === 'completed') return renderDone(data);
    if (data.status === 'closed') return renderWelcome();
    switch (data.currentStepId) {
      case 'phone': return renderPhone();
      case 'otp': return renderOtp(data);
      case 'pin': return submitPinAndRender();
      case 'pinConfirmation': return renderPin(data);
      default: return renderWelcome();
    }
  }

  async function refresh() {
    try {
      const current = await api('GET', '/onboardings/current');
      routeByStep(current);
    } catch (err) {
      if (err.status === 404) return renderWelcome();
      if (err.status === 401) { clearToken(); return renderWelcome(); }
      renderLoadError(apiMessage(err));
    }
  }

  async function submitPinAndRender() {
    renderLoading('Generando tu PIN…');
    try {
      const data = await api('PUT', '/onboardings/current/steps/pin', { answers: {} }, { idempotent: true });
      lastPin = data.generatedPin || null;
      renderPin(data);
    } catch (err) {
      if (err.status === 409) return refresh();
      renderLoadError(apiMessage(err));
    }
  }

  async function startOnboarding() {
    setBusy(true);
    renderLoading('Iniciando tu alta…');
    try {
      await api('POST', '/onboardings', undefined, { idempotent: true });
      renderPhone();
    } catch (err) {
      if (err.status === 409) {
        showView('v-welcome');
        setError($('accountMsg'), apiMessage(err));
        $('accountMsg').hidden = false;
        return;
      }
      renderLoadError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitPhone() {
    const number = $('phone').value;
    setBusy(true);
    setError($('phoneError'), '');
    try {
      const data = await api('PUT', '/onboardings/current/steps/phone', {
        answers: { phoneNumber: number, termsAccepted: true },
      }, { idempotent: true });
      phoneNumber = number;
      renderOtp(data);
    } catch (err) {
      const first = firstError(err);
      setError($('phoneError'), (first && first.message) || apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp() {
    setBusy(true);
    setError($('otpError'), '');
    try {
      const data = await api('PUT', '/onboardings/current/steps/otp', {
        answers: { otpCode: otpCode() },
      }, { idempotent: true });
      routeByStep(data);
    } catch (err) {
      await handleOtpError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleOtpError(err) {
    const first = firstError(err);
    const code = first && first.code;
    const problem = err.problem || {};
    if (code === 'OTP_ATTEMPTS_EXCEEDED') {
      setOtpDisabled(true);
      const seconds = problem.retryAfterSeconds || 0;
      setError($('otpError'), 'Demasiados intentos. Espera ' + seconds + ' s antes de volver a intentar.');
      updateOtpButton();
      setTimeout(() => {
        setOtpDisabled(false);
        setError($('otpError'), '');
        updateOtpButton();
      }, seconds * 1000);
      return;
    }
    if (code === 'OTP_EXPIRED') {
      setOtpDisabled(true);
      $('otpInfo').textContent = 'El código venció. Pide uno nuevo.';
      setError($('otpError'), first.message);
      updateOtpButton();
      return;
    }
    if (code === 'OTP_INVALID') {
      clearOtpInputs();
      const left = problem.attemptsLeft;
      const msg = first.message + (typeof left === 'number' ? ' Te quedan ' + left + ' intentos.' : '');
      setError($('otpError'), msg);
      $('otpRow').children[0].focus();
      updateOtpButton();
      return;
    }
    setError($('otpError'), apiMessage(err));
  }

  async function resendOtp() {
    setBusy(true);
    setError($('otpError'), '');
    try {
      const data = await api('POST', '/onboardings/current/otp/resend', undefined, { idempotent: true });
      clearOtpInputs();
      setOtpDisabled(false);
      startOtpCountdown(data.otp && data.otp.expiresAt);
      startResendCooldown();
      updateOtpButton();
    } catch (err) {
      setError($('otpError'), apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function changePhone() {
    clearInterval(otpTimer);
    $('phone').value = phoneNumber || '';
    $('terms').checked = true;
    setError($('phoneError'), '');
    updatePhoneButton();
    showView('v-phone');
  }

  async function regeneratePin() {
    setBusy(true);
    setError($('pinError'), '');
    try {
      const data = await api('POST', '/onboardings/current/pin/regenerate', undefined, { idempotent: true });
      lastPin = data.generatedPin || null;
      renderPinDisplay(lastPin, false);
      $('btnShowPin').textContent = 'Mostrar';
      applyPinState(data);
      $('pinSaved').checked = false;
      $('btnPin').disabled = true;
    } catch (err) {
      setError($('pinError'), apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleShowPin() {
    const showing = $('btnShowPin').textContent === 'Ocultar';
    renderPinDisplay(lastPin, !showing);
    $('btnShowPin').textContent = showing ? 'Mostrar' : 'Ocultar';
  }

  async function confirmPin() {
    setBusy(true);
    setError($('pinError'), '');
    try {
      const data = await api('PUT', '/onboardings/current/steps/pinConfirmation', {
        answers: { pinSavedConfirmation: true },
      }, { idempotent: true });
      lastPin = null;
      renderPinDisplay(null, false);
      renderDone(data);
    } catch (err) {
      setError($('pinError'), apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetAndRestart() {
    resetSession();
    renderLoading('Preparando un nuevo alta…');
    await startOnboarding();
  }

  function bindEvents() {
    $('btnStart').addEventListener('click', startOnboarding);

    $('btnHasAccount').addEventListener('click', () => {
      setError($('accountMsg'), 'Ya tienes una cuenta. Inicia sesión para continuar.');
      $('accountMsg').hidden = false;
    });

    $('phone').addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 9);
      setError($('phoneError'), '');
      updatePhoneButton();
    });
    $('terms').addEventListener('change', updatePhoneButton);
    $('termsLink').addEventListener('click', (e) => e.preventDefault());
    $('policyLink').addEventListener('click', (e) => e.preventDefault());
    $('btnPhone').addEventListener('click', submitPhone);

    $('btnOtp').addEventListener('click', submitOtp);
    $('resend').addEventListener('click', resendOtp);
    $('changePhone').addEventListener('click', changePhone);

    $('btnShowPin').addEventListener('click', toggleShowPin);
    $('btnRegenerate').addEventListener('click', regeneratePin);
    $('pinSaved').addEventListener('change', () => {
      $('btnPin').disabled = !$('pinSaved').checked;
    });
    $('btnPin').addEventListener('click', confirmPin);

    $('btnRestart').addEventListener('click', resetAndRestart);

    document.querySelectorAll('[data-back]').forEach((btn) => {
      btn.addEventListener('click', () => showView(btn.dataset.back));
    });
  }

  bindEvents();
  refresh();
})();
