'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('apps/web-prototype/auth-controller.js', 'utf8'), context);
  return { api: context.window.YYJAuthController, context };
}
const plain = value => JSON.parse(JSON.stringify(value));
function assertNoSensitiveState(value) {
  assert.equal(Object.keys(value).some(key => /^(token|session|user|accessToken|refreshToken)$/i.test(key)), false);
}

function setup(overrides = {}) {
  const calls = [], changes = [], authenticated = [], sequence = overrides.sequence || null;
  const deferred = overrides.deferred;
  const supabaseAuth = overrides.supabaseAuth || {
    requestEmailOtp: async email => { calls.push(['requestEmailOtp', email]); return { sent: true, email: email.trim().toLowerCase() }; },
    verifyEmailOtp: async (email, token) => { calls.push(['verifyEmailOtp', email, token]); },
    signOut: async () => { calls.push(['signOut']); }
  };
  const dataStore = overrides.dataStore || {
    getCurrentUser: async () => { calls.push(['getCurrentUser']); return { id: 'u1' }; },
    loadServerData: async () => { calls.push(['loadServerData']); return { places: ['p'], collections: ['c'] }; },
    logout: async () => { calls.push(['logout']); }
  };
  const loaded = load();
  const controller = loaded.api.create({ supabaseAuth, dataStore, onChange: snapshot => changes.push(snapshot), onAuthenticated: (...args) => { calls.push(['onAuthenticated', ...args]); if (sequence) sequence.push('onAuthenticated'); authenticated.push(args); } });
  return { controller, calls, changes, authenticated, deferred, api: loaded.api, context: loaded.context };
}

async function run() {
  let t = setup();
  assert.deepEqual(Object.keys(t.api).sort(), ['create']);
  assert.deepEqual(Object.keys(t.controller).sort(), ['cancelOtp', 'getState', 'handleInitialIssue', 'requestOtp', 'resendOtp', 'setMode', 'verifyOtp'].sort());
  assert.deepEqual(plain(t.controller.getState()), { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' });
  assertNoSensitiveState(t.controller.getState());
  for (const mode of ['register', 'otp-request', 'otp-verify', 'otp-unlinked', 'otp-conflict', 'login']) t.controller.setMode(mode);
  const before = t.changes.length; t.controller.setMode('invalid'); assert.equal(t.changes.length, before);
  const copyTest = setup(); copyTest.controller.setMode('register'); const emitted = copyTest.changes.at(-1); assert.ok(emitted); emitted.mode = 'otp-conflict'; emitted.error = 'mutated'; assert.equal(copyTest.controller.getState().mode, 'register'); assert.equal(copyTest.controller.getState().error, '');
  const snapshot = t.controller.getState(); snapshot.mode = 'register'; assert.equal(t.controller.getState().mode, 'login');
  t.changes[0].mode = 'register'; t.changes[0].error = 'changed'; assert.equal(t.controller.getState().mode, 'login'); assert.equal(t.controller.getState().error, '');
  assert.deepEqual(Object.keys(t.controller.getState()).filter(k => /token|session|user|accessToken|refreshToken/i.test(k)), []);

  await t.controller.setMode('otp-request'); await t.controller.requestOtp('  User@Example.COM ');
  assert.deepEqual(t.calls[0], ['requestEmailOtp', '  User@Example.COM ']);
  assert.equal(t.controller.getState().otpEmail, 'user@example.com');
  assert.equal(t.controller.getState().mode, 'otp-verify');
  assert.equal(t.controller.getState().notice, '인증 코드를 보냈습니다. 받은 편지함을 확인해 주세요.');
  assertNoSensitiveState(t.controller.getState()); for (const change of t.changes) assertNoSensitiveState(change);

  t = setup({ supabaseAuth: { requestEmailOtp: async () => { throw new Error('raw otp request detail'); }, verifyEmailOtp: async () => {}, signOut: async () => {} } }); t.controller.setMode('otp-request'); await t.controller.requestOtp('a@example.com'); assert.equal(t.controller.getState().mode, 'otp-request'); assert.equal(t.controller.getState().error, '인증 코드를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.'); assert.equal(t.controller.getState().pending, false); assert.equal(t.controller.getState().otpEmail, ''); assert.equal(t.controller.getState().notice, ''); assert.equal(JSON.stringify(t.controller.getState()).includes('raw otp request detail'), false);

  let resolveRequest; const pending = new Promise(resolve => { resolveRequest = resolve; });
  t = setup({ supabaseAuth: { requestEmailOtp: async email => { t.calls.push(['requestEmailOtp', email]); return pending; }, verifyEmailOtp: async () => {}, signOut: async () => {} } });
  t.controller.setMode('otp-request'); const first = t.controller.requestOtp('a@example.com'); await Promise.resolve(); assert.equal(t.controller.getState().pending, true); const second = t.controller.requestOtp('b@example.com'); await Promise.resolve(); assert.equal(t.calls.length, 1); resolveRequest({ email: 'a@example.com' }); await first; await second; assert.equal(t.controller.getState().pending, false); assert.equal(t.controller.getState().mode, 'otp-verify'); assert.equal(t.controller.getState().otpEmail, 'a@example.com'); assert.equal(t.controller.getState().notice, '인증 코드를 보냈습니다. 받은 편지함을 확인해 주세요.'); assertNoSensitiveState(t.controller.getState());

  const order = []; t = setup({ sequence: order, supabaseAuth: { requestEmailOtp: async () => ({ email: 'a@example.com' }), verifyEmailOtp: async () => order.push('verifyEmailOtp'), signOut: async () => {} }, dataStore: { getCurrentUser: async () => { order.push('getCurrentUser'); return 'user'; }, loadServerData: async () => { order.push('loadServerData'); return { places: ['p'], collections: ['c'] }; } } });
  await t.controller.requestOtp('a@example.com'); await t.controller.verifyOtp('123456'); assert.deepEqual(order, ['verifyEmailOtp', 'getCurrentUser', 'loadServerData', 'onAuthenticated']); assert.deepEqual(t.authenticated, [['user', ['p'], ['c']]]);

  let resolveVerify; let verifyCalls = 0; t = setup({ supabaseAuth: { requestEmailOtp: async () => ({ email: 'a@example.com' }), verifyEmailOtp: async () => { verifyCalls += 1; return new Promise(resolve => { resolveVerify = resolve; }); }, signOut: async () => {} } }); await t.controller.requestOtp('a@example.com'); const verifyOne = t.controller.verifyOtp('123456'); await Promise.resolve(); assert.equal(t.controller.getState().pending, true); const verifyTwo = t.controller.verifyOtp('654321'); await Promise.resolve(); assert.equal(verifyCalls, 1); resolveVerify(); await verifyOne; await verifyTwo; assert.equal(t.controller.getState().pending, false);

  for (const shape of [{ payload: { error: 'auth_user_not_linked' } }, { error: 'auth_user_not_linked' }, { code: 'auth_user_not_linked' }, { payload: { error: 'auth_identity_conflict' } }, { error: 'auth_identity_conflict' }, { code: 'auth_identity_conflict' }]) {
    t = setup({ supabaseAuth: { requestEmailOtp: async () => ({ email: 'a@example.com' }), verifyEmailOtp: async () => { throw shape; }, signOut: async () => {} }, dataStore: { getCurrentUser: async () => { throw new Error('must not run'); }, loadServerData: async () => { throw new Error('must not run'); } } });
    shape.message = 'raw identity detail'; await t.controller.requestOtp('a@example.com'); await t.controller.verifyOtp('123456'); const state = t.controller.getState(); const issue = shape.error || shape.payload?.error || shape.code; assert.equal(state.mode, issue === 'auth_identity_conflict' ? 'otp-conflict' : 'otp-unlinked'); assert.equal(state.issue, issue); assert.equal(state.error, issue === 'auth_identity_conflict' ? '현재 비밀번호 로그인과 다른 이메일 인증 계정입니다. 이메일 인증을 종료한 뒤 다시 시도해 주세요.' : '이 이메일 인증 계정은 아직 여기였지 계정에 연결되지 않았습니다. 기존 이메일과 비밀번호로 로그인해 주세요.'); assert.equal(state.pending, false); assert.equal(JSON.stringify(state).includes('raw identity detail'), false); assert.equal(t.calls.some(c => c[0] === 'loadServerData'), false); assert.equal(t.authenticated.length, 0);
  }
  t = setup({ supabaseAuth: { requestEmailOtp: async () => ({ email: 'a@example.com' }), verifyEmailOtp: async () => { throw new Error('raw sdk verification detail'); }, signOut: async () => {} } }); await t.controller.requestOtp('a@example.com'); await t.controller.verifyOtp('bad'); assert.equal(t.controller.getState().mode, 'otp-verify'); assert.equal(t.controller.getState().error, '인증 코드가 올바르지 않거나 만료되었습니다.'); assert.equal(t.controller.getState().pending, false); assert.equal(JSON.stringify(t.controller.getState()).includes('raw sdk verification detail'), false); assert.equal(t.calls.some(c => c[0] === 'getCurrentUser'), false); assert.equal(t.calls.some(c => c[0] === 'loadServerData'), false); assert.equal(t.authenticated.length, 0);

  t = setup(); await t.controller.resendOtp(); assert.equal(t.calls.length, 0); assert.equal(t.controller.getState().error, '이메일 주소를 입력해 주세요.'); await t.controller.requestOtp('Original@Example.com'); await t.controller.resendOtp(); assert.equal(t.calls[1][1], 'original@example.com'); assert.equal(t.controller.getState().mode, 'otp-verify'); assert.equal(t.controller.getState().pending, false); assert.equal(t.controller.getState().notice, '인증 코드를 보냈습니다. 받은 편지함을 확인해 주세요.');
  let resolveResend; let resendCalls = 0; let resendPhase = false; t = setup({ supabaseAuth: { requestEmailOtp: async email => { resendCalls++; if (!resendPhase) { resendPhase = true; return { email }; } return new Promise(resolve => { resolveResend = () => resolve({ email }); }); }, verifyEmailOtp: async () => {}, signOut: async () => {} } }); await t.controller.requestOtp('normalized@example.com'); const resendOne = t.controller.resendOtp(); await Promise.resolve(); assert.equal(t.controller.getState().pending, true); const resendTwo = t.controller.resendOtp(); await Promise.resolve(); assert.equal(resendCalls, 2); resolveResend(); await resendOne; await resendTwo; assert.equal(t.controller.getState().pending, false); assert.equal(t.controller.getState().mode, 'otp-verify');
  t = setup(); t.controller.setMode('otp-verify'); await t.controller.cancelOtp(); assert.deepEqual(t.calls.map(c => c[0]), ['signOut']); assert.deepEqual(plain(t.controller.getState()), { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' });
  let signOutCalls = 0; t = setup({ supabaseAuth: { requestEmailOtp: async () => ({ email: 'a' }), verifyEmailOtp: async () => {}, signOut: async () => { signOutCalls++; throw new Error('raw signout detail'); } } }); t.controller.setMode('otp-verify'); await t.controller.cancelOtp(); assert.equal(signOutCalls, 1); assert.equal(t.calls.some(c => c[0] === 'logout'), false); assert.equal(t.controller.getState().error, '이메일 인증을 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.'); assert.equal(t.controller.getState().pending, false); assert.equal(JSON.stringify(t.controller.getState()).includes('raw signout detail'), false);
  let resolveSignOut; signOutCalls = 0; t = setup({ supabaseAuth: { requestEmailOtp: async () => ({ email: 'a' }), verifyEmailOtp: async () => {}, signOut: async () => { signOutCalls++; return new Promise(resolve => { resolveSignOut = resolve; }); } } }); t.controller.setMode('otp-verify'); const cancelOne = t.controller.cancelOtp(); await Promise.resolve(); assert.equal(t.controller.getState().pending, true); const cancelTwo = t.controller.cancelOtp(); await Promise.resolve(); assert.equal(signOutCalls, 1); resolveSignOut(); await cancelOne; await cancelTwo; assert.deepEqual(plain(t.controller.getState()), { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' }); assert.equal(t.calls.some(c => c[0] === 'logout'), false);
  t = setup(); t.controller.handleInitialIssue('auth_user_not_linked'); assert.equal(t.controller.getState().mode, 'otp-unlinked'); assert.equal(t.controller.getState().issue, 'auth_user_not_linked'); assert.equal(t.controller.getState().error, '이 이메일 인증 계정은 아직 여기였지 계정에 연결되지 않았습니다. 기존 이메일과 비밀번호로 로그인해 주세요.'); assert.equal(t.controller.getState().pending, false); const count = t.changes.length; t.controller.handleInitialIssue('auth_identity_conflict'); assert.equal(t.controller.getState().mode, 'otp-conflict'); assert.equal(t.controller.getState().issue, 'auth_identity_conflict'); assert.equal(t.controller.getState().error, '현재 비밀번호 로그인과 다른 이메일 인증 계정입니다. 이메일 인증을 종료한 뒤 다시 시도해 주세요.'); assert.equal(t.controller.getState().pending, false); const beforeUnknown = plain(t.controller.getState()); const afterKnown = t.changes.length; t.controller.handleInitialIssue('unknown'); assert.deepEqual(plain(t.controller.getState()), beforeUnknown); assert.equal(t.changes.length, afterKnown); assert.ok(afterKnown > count);
  for (const change of t.changes) assertNoSensitiveState(change);
  console.log('Auth controller tests passed: isolated API, modes, OTP, errors, pending guards, cancel, and snapshots');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
