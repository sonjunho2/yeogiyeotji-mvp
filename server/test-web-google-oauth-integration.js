'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync('apps/web-prototype/app.js', 'utf8');
const authSource = fs.readFileSync('apps/web-prototype/supabase-auth.js', 'utf8');
const controllerSource = fs.readFileSync('apps/web-prototype/auth-controller.js', 'utf8');
const workerSource = fs.readFileSync('apps/web-prototype/service-worker.js', 'utf8');

class Element {
  constructor(id = '') { this.id = id; this.className = ''; this.textContent = ''; this.innerHTML = ''; this.disabled = false; this.onclick = null; this.onsubmit = null; this.classList = { add() {}, remove() {} }; }
  addEventListener() {}
  close() {}
  after(element) { this.afterElement = element; if (element.id) this.ownerDocument.elements[element.id] = element; }
  querySelector(selector) { return selector === '[type=submit]' ? this.ownerDocument.createElement('button') : this.ownerDocument.querySelector(selector); }
  click() { if (!this.disabled && this.onclick) return this.onclick({ currentTarget: this }); }
}
function createHarness() {
  const elements = {};
  const document = {
    elements,
    body: { classList: { add() {}, remove() {}, contains() { return true; } } },
    createElement: tag => { const element = new Element(); element.tagName = tag; element.ownerDocument = document; return element; },
    getElementById: id => elements[id] || (elements[id] = Object.assign(new Element(id), { ownerDocument: document })),
    querySelector: selector => selector.startsWith('#') ? document.getElementById(selector.slice(1)) : Object.assign(new Element(), { ownerDocument: document }),
    querySelectorAll: () => [],
  };
  ['view', 'headerTitle', 'headerEyebrow', 'settingsDialog', 'storageStatus'].forEach(id => { const element = new Element(id); element.ownerDocument = document; elements[id] = element; });
  const view = elements.view;
  Object.defineProperty(view, 'innerHTML', { get: () => view._html || '', set: html => { view._html = html; for (const id of ['authForm', 'authSwitch', 'authError', 'googleLoginButton', 'otpIssueCancel', 'otpForm', 'otpCancel', 'otpResend']) { if (html.includes(`id="${id}"`)) { const element = new Element(id); element.ownerDocument = document; element.innerHTML = html; const match = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`)); element.textContent = match ? match[1] : ''; elements[id] = element; } } } });
  const controller = { state: { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' }, googleCalls: 0, cancelCalls: 0, getState() { return { ...this.state }; }, setMode(mode) { this.state.mode = mode; }, startGoogleOAuth() { this.googleCalls++; }, cancelOtp() { this.cancelCalls++; } };
  const context = { document, window: {}, console, URL, fetch: () => Promise.resolve({ ok: true, json: async () => ({}) }), navigator: {}, location: { href: '', reload() {} }, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, addEventListener() {}, setTimeout() {}, Intl, YYJSupabaseAuth: { isEmailOtpEnabled: () => false, isGoogleOAuthEnabled: () => true }, YYJDataStore: { AuthenticationError: class AuthenticationError {}, create: undefined, initialize: async () => ({}) } };
  context.window = context; context.window.YYJAuthController = { create: () => controller }; context.window.YYJSupabaseAuth = context.YYJSupabaseAuth;
  const source = appSource.replace('initializeApp();', 'globalThis.__setAuthViewState = value => { authViewState = value; }; globalThis.__renderAuth = renderAuth; globalThis.__renderOtpIssue = renderOtpIssue;');
  vm.createContext(context); vm.runInContext(source, context);
  return { context, document, view, controller };
}

function render(harness, state) {
  harness.controller.state = { ...harness.controller.state, ...state };
  harness.context.__setAuthViewState({ ...harness.controller.state });
  harness.context.__renderAuth.call(harness.context);
}

assert.match(appSource, /googleLoginButton/);
assert.match(appSource, /startGoogleOAuth/);
assert.doesNotMatch(appSource, /signInWithIdToken|google\.accounts|client_secret/i);
assert.match(authSource, /signInWithOAuth/);
assert.match(authSource, /provider: 'google'/);
assert.doesNotMatch(authSource, /console\.(log|error).*?(access_token|refresh_token|oauth)/i);
assert.match(controllerSource, /startGoogleOAuth/);
assert.match(workerSource, /yeogiyeotji-v10/);

let h = createHarness();
render(h, { mode: 'login', pending: false, notice: '', error: '' });
assert.ok(h.document.getElementById('googleLoginButton'));
assert.equal(h.document.getElementById('googleLoginButton').textContent, 'Google로 로그인');
assert.equal(h.document.getElementById('googleLoginButton').disabled, false);
h.document.getElementById('googleLoginButton').click(); assert.equal(h.controller.googleCalls, 1);

h = createHarness(); render(h, { mode: 'login', pending: true }); assert.ok(h.document.getElementById('googleLoginButton')); assert.equal(h.document.getElementById('googleLoginButton').textContent, 'Google 로그인 준비 중…'); assert.equal(h.document.getElementById('googleLoginButton').disabled, true); const pendingButton = h.document.getElementById('googleLoginButton'); pendingButton.click(); pendingButton.click(); assert.equal(h.controller.googleCalls, 0);
h = createHarness(); render(h, { mode: 'register' }); assert.equal(h.document.elements.googleLoginButton || null, null);
h = createHarness(); h.context.YYJSupabaseAuth.isGoogleOAuthEnabled = () => false; render(h, { mode: 'login' }); assert.equal(h.document.elements.googleLoginButton || null, null);

h = createHarness(); render(h, { mode: 'login', notice: '<img src=x onerror="globalThis.__noticeExecuted=true">', error: '<script>globalThis.__errorExecuted=true</script>' }); assert.equal(h.context.__noticeExecuted, undefined); assert.equal(h.context.__errorExecuted, undefined); assert.match(h.view._html, /&lt;img/); assert.match(h.view._html, /&lt;script/); assert.match(h.document.getElementById('authError').innerHTML, /&lt;script/);

h = createHarness(); h.controller.state = { mode: 'otp-conflict', error: 'auth_identity_conflict', pending: false }; h.context.__setAuthViewState({ ...h.controller.state }); h.context.__renderOtpIssue(); const issueButton = h.document.getElementById('otpIssueCancel'); assert.equal(issueButton.textContent, '인증 종료 후 다시 시도'); assert.doesNotMatch(h.view._html, /이메일 인증 종료 후 다시 시도/); assert.doesNotMatch(h.view._html, /이메일 인증을 종료한 뒤 다시 시도/); assert.doesNotMatch(h.view._html, /이메일 인증이 종료되면 다시 시도/); issueButton.click(); assert.equal(h.controller.cancelCalls, 1);
console.log('Web Google OAuth integration tests passed: VM UI rendering, button behavior, safe notices/errors, conflict recovery, wrapper, controller, and security boundaries');
