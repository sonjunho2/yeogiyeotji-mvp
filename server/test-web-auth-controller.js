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
function assertNoLinkSensitiveData(state, changes, extraForbidden = []) {
  const serialized = JSON.stringify({ state, changes });
  for (const forbidden of ['existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3', 'JWT_SECRET_SENTINEL_5_3', 'SESSION_SECRET_SENTINEL_5_3', 'RAW_ERROR_SENTINEL', 'accessToken', 'refreshToken', ...extraForbidden]) assert.equal(serialized.includes(forbidden), false, `sensitive value exposed: ${forbidden}`);
  for (const key of ['token', 'session', 'accessToken', 'refreshToken']) assert.equal(Object.prototype.hasOwnProperty.call(state, key), false);
}

function setup(overrides = {}) {
  const calls = [], changes = [], authenticated = [], sequence = overrides.sequence || null;
  const deferred = overrides.deferred;
  const supabaseAuth = overrides.supabaseAuth || {
    requestEmailOtp: async email => { calls.push(['requestEmailOtp', email]); return { sent: true, email: email.trim().toLowerCase() }; },
    verifyEmailOtp: async (email, token) => { calls.push(['verifyEmailOtp', email, token]); },
    signOut: async () => { calls.push(['signOut']); }
  };
  const dataStore = { logoutLegacySession: async () => { calls.push(['logoutLegacySession']); }, ...(overrides.dataStore || {
    getCurrentUser: async () => { calls.push(['getCurrentUser']); return { id: 'u1' }; },
    loadServerData: async () => { calls.push(['loadServerData']); return { places: ['p'], collections: ['c'] }; },
    logout: async () => { calls.push(['logout']); },
  }) };
  const loaded = load();
  const onAuthenticated = overrides.onAuthenticated || ((...args) => { calls.push(['onAuthenticated', ...args]); if (sequence) sequence.push('onAuthenticated'); authenticated.push(args); });
  const onChange = snapshot => { changes.push(snapshot); if (overrides.onChange) overrides.onChange(snapshot); };
  const controller = loaded.api.create({ supabaseAuth, dataStore, onChange, onAuthenticated });
  return { controller, calls, changes, authenticated, deferred, api: loaded.api, context: loaded.context };
}

async function assertLinkModeRestrictions() { for (const mode of ['login', 'register', 'otp-request', 'otp-verify', 'otp-conflict']) { const counters = { login: 0, linkSupabaseAccount: 0, getCurrentUser: 0, loadServerData: 0, onAuthenticated: 0 }; const t = setup({ dataStore: { login: async () => { counters.login += 1; }, linkSupabaseAccount: async () => { counters.linkSupabaseAccount += 1; }, getCurrentUser: async () => { counters.getCurrentUser += 1; return {}; }, loadServerData: async () => { counters.loadServerData += 1; return {}; } }, onAuthenticated: () => { counters.onAuthenticated += 1; } }); t.controller.setMode(mode); assert.equal(await t.controller.linkExistingAccount('existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3'), null); assert.deepEqual(counters, { login: 0, linkSupabaseAccount: 0, getCurrentUser: 0, loadServerData: 0, onAuthenticated: 0 }); assert.equal(t.controller.getState().pending, false); assertNoLinkSensitiveData(t.controller.getState(), t.changes); } }
async function assertLinkSuccessSequence() { const sequence = [], changes = [], authenticated = []; let pendingAtAuthentication = null; let issueAtAuthentication = null; let controller; const onAuthenticated = (user, places, collections) => { sequence.push('onAuthenticated'); pendingAtAuthentication = controller.getState().pending; issueAtAuthentication = controller.getState().issue; authenticated.push([user, places, collections]); }; const t = setup({ sequence, onAuthenticated, dataStore: { login: async () => sequence.push('login'), linkSupabaseAccount: async () => sequence.push('linkSupabaseAccount'), getCurrentUser: async () => { sequence.push('getCurrentUser'); return { id: 'user-5-3' }; }, loadServerData: async () => { sequence.push('loadServerData'); return { places: ['place-5-3'], collections: ['collection-5-3'] }; } } }); controller = t.controller; controller.handleInitialIssue('auth_user_not_linked'); assert.equal(controller.getState().mode, 'otp-unlinked'); assert.equal(controller.getState().issue, 'auth_user_not_linked'); const result = await controller.linkExistingAccount('existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3'); changes.push(...t.changes); assert.deepEqual(sequence, ['login', 'linkSupabaseAccount', 'getCurrentUser', 'loadServerData', 'onAuthenticated']); assert.deepEqual(result.user, { id: 'user-5-3' }); assert.deepEqual(result.data.places, ['place-5-3']); assert.deepEqual(result.data.collections, ['collection-5-3']); assert.deepEqual(authenticated, [[{ id: 'user-5-3' }, ['place-5-3'], ['collection-5-3']]]); assert.equal(authenticated.length, 1); assert.equal(pendingAtAuthentication, false); assert.equal(issueAtAuthentication, ''); assert.equal(controller.getState().pending, false); assertNoLinkSensitiveData(controller.getState(), changes); }
async function assertLinkPendingGuard() { let resolveLogin; const counters = { login: 0, linkSupabaseAccount: 0, getCurrentUser: 0, loadServerData: 0, onAuthenticated: 0 }; const order = []; const t = setup({ sequence: order, onAuthenticated: () => { counters.onAuthenticated += 1; order.push('onAuthenticated'); }, dataStore: { login: async () => { counters.login += 1; order.push('login'); return new Promise(resolve => { resolveLogin = resolve; }); }, linkSupabaseAccount: async () => { counters.linkSupabaseAccount += 1; order.push('linkSupabaseAccount'); }, getCurrentUser: async () => { counters.getCurrentUser += 1; order.push('getCurrentUser'); return {}; }, loadServerData: async () => { counters.loadServerData += 1; order.push('loadServerData'); return { places: [], collections: [] }; } } }); t.controller.handleInitialIssue('auth_user_not_linked'); assert.equal(t.controller.getState().mode, 'otp-unlinked'); assert.equal(t.controller.getState().issue, 'auth_user_not_linked'); const first = t.controller.linkExistingAccount('existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3'); await Promise.resolve(); assert.equal(t.controller.getState().pending, true); assert.equal(t.controller.getState().issue, ''); assert.equal(counters.login, 1); assert.deepEqual(counters, { login: 1, linkSupabaseAccount: 0, getCurrentUser: 0, loadServerData: 0, onAuthenticated: 0 }); const secondCredentials = ['second@example.com', 'SECOND_PASSWORD_SENTINEL']; assert.equal(await t.controller.linkExistingAccount(...secondCredentials), null); assert.deepEqual(counters, { login: 1, linkSupabaseAccount: 0, getCurrentUser: 0, loadServerData: 0, onAuthenticated: 0 }); resolveLogin(); await first; assert.deepEqual(counters, { login: 1, linkSupabaseAccount: 1, getCurrentUser: 1, loadServerData: 1, onAuthenticated: 1 }); assert.deepEqual(order, ['login', 'linkSupabaseAccount', 'getCurrentUser', 'loadServerData', 'onAuthenticated']); assert.equal(t.controller.getState().pending, false); assert.equal(t.controller.getState().issue, ''); assertNoLinkSensitiveData(t.controller.getState(), t.changes, secondCredentials); }
async function assertLinkErrorMappings() { const loginFailureCodes = new Set(['invalid_credentials', 'reauthentication_failed']); const linkErrorMessages = { invalid_credentials: '기존 계정의 이메일 또는 비밀번호를 확인해 주세요.', reauthentication_failed: '기존 계정의 이메일 또는 비밀번호를 확인해 주세요.', auth_link_conflict: '계정을 연결할 수 없습니다. 인증을 종료한 뒤 다시 시도해 주세요.', auth_identity_conflict: '계정을 연결할 수 없습니다. 인증을 종료한 뒤 다시 시도해 주세요.', bearer_required: 'Google 인증이 만료되었습니다. 인증을 종료한 뒤 다시 시도해 주세요.', invalid_authorization: 'Google 인증이 만료되었습니다. 인증을 종료한 뒤 다시 시도해 주세요.', invalid_token: 'Google 인증이 만료되었습니다. 인증을 종료한 뒤 다시 시도해 주세요.', auth_link_unavailable: '계정 연결을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.', validation_error: '입력값을 확인해 주세요.', unknown_error: '계정을 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }; const errorShapes = [code => ({ payload: { error: code }, message: 'RAW_ERROR_SENTINEL' }), code => ({ error: code, message: 'RAW_ERROR_SENTINEL' }), code => ({ code, message: 'RAW_ERROR_SENTINEL' })]; let executedCases = 0; for (const [code, expected] of Object.entries(linkErrorMessages)) for (const shape of errorShapes) { const sequence = []; const counters = { login: 0, linkSupabaseAccount: 0, getCurrentUser: 0, loadServerData: 0, onAuthenticated: 0 }; const error = shape(code); const loginFailure = loginFailureCodes.has(code); const t = setup({ dataStore: { login: async () => { counters.login += 1; sequence.push('login'); if (loginFailure) throw error; }, linkSupabaseAccount: async () => { counters.linkSupabaseAccount += 1; sequence.push('linkSupabaseAccount'); if (!loginFailure) throw error; }, getCurrentUser: async () => { counters.getCurrentUser += 1; sequence.push('getCurrentUser'); return { id: 'unexpected-user' }; }, loadServerData: async () => { counters.loadServerData += 1; sequence.push('loadServerData'); return { places: ['unexpected-place'], collections: ['unexpected-collection'] }; } }, onAuthenticated: () => { counters.onAuthenticated += 1; sequence.push('onAuthenticated'); } }); t.controller.handleInitialIssue('auth_user_not_linked'); assert.equal(t.controller.getState().mode, 'otp-unlinked'); assert.equal(t.controller.getState().issue, 'auth_user_not_linked'); await t.controller.linkExistingAccount('existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3'); const state = t.controller.getState(); const expectedCounters = loginFailure ? { login: 1, linkSupabaseAccount: 0, getCurrentUser: 0, loadServerData: 0, onAuthenticated: 0 } : { login: 1, linkSupabaseAccount: 1, getCurrentUser: 0, loadServerData: 0, onAuthenticated: 0 }; assert.deepEqual(counters, expectedCounters); assert.equal(state.error, expected); const conflict = code === 'auth_link_conflict' || code === 'auth_identity_conflict'; assert.equal(state.mode, conflict ? 'otp-conflict' : 'otp-unlinked'); assert.equal(state.issue, conflict ? code : ''); assert.deepEqual(sequence, loginFailure ? ['login'] : ['login', 'linkSupabaseAccount']); assert.equal(state.pending, false); assert.equal(JSON.stringify(state).includes('RAW_ERROR_SENTINEL'), false); assertNoLinkSensitiveData(state, t.changes); executedCases += 1; } assert.equal(executedCases, 10 * 3); for (const stage of ['getCurrentUser', 'loadServerData']) { const sequence = []; const counters = { login: 0, linkSupabaseAccount: 0, getCurrentUser: 0, loadServerData: 0, onAuthenticated: 0 }; const t = setup({ dataStore: { login: async () => { counters.login += 1; sequence.push('login'); }, linkSupabaseAccount: async () => { counters.linkSupabaseAccount += 1; sequence.push('linkSupabaseAccount'); }, getCurrentUser: async () => { counters.getCurrentUser += 1; sequence.push('getCurrentUser'); if (stage === 'getCurrentUser') throw new Error('getCurrentUser failure sentinel'); return { id: 'unexpected-user' }; }, loadServerData: async () => { counters.loadServerData += 1; sequence.push('loadServerData'); if (stage === 'loadServerData') throw new Error('loadServerData failure sentinel'); return { places: ['unexpected-place'], collections: ['unexpected-collection'] }; } }, onAuthenticated: () => { counters.onAuthenticated += 1; sequence.push('onAuthenticated'); } }); t.controller.handleInitialIssue('auth_user_not_linked'); assert.equal(t.controller.getState().mode, 'otp-unlinked'); assert.equal(t.controller.getState().issue, 'auth_user_not_linked'); await t.controller.linkExistingAccount('existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3'); assert.deepEqual(sequence, stage === 'getCurrentUser' ? ['login', 'linkSupabaseAccount', 'getCurrentUser'] : ['login', 'linkSupabaseAccount', 'getCurrentUser', 'loadServerData']); assert.deepEqual(counters, stage === 'getCurrentUser' ? { login: 1, linkSupabaseAccount: 1, getCurrentUser: 1, loadServerData: 0, onAuthenticated: 0 } : { login: 1, linkSupabaseAccount: 1, getCurrentUser: 1, loadServerData: 1, onAuthenticated: 0 }); assert.equal(t.controller.getState().error, '계정을 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); assert.equal(t.controller.getState().pending, false); assert.equal(t.controller.getState().mode, 'otp-unlinked'); assert.equal(t.controller.getState().issue, ''); assertNoLinkSensitiveData(t.controller.getState(), t.changes, [stage + ' failure sentinel']); } }
async function assertInitialAndLinkConflictDiffer() { const initial = setup(); initial.controller.handleInitialIssue('auth_identity_conflict'); assertNoLinkSensitiveData(initial.controller.getState(), initial.changes); assert.equal(initial.controller.getState().mode, 'otp-conflict'); assert.equal(initial.controller.getState().issue, 'auth_identity_conflict'); assert.equal(initial.controller.getState().error, '현재 비밀번호 로그인과 다른 인증 계정입니다. 인증을 종료한 뒤 다시 시도해 주세요.'); const linked = setup({ dataStore: { login: async () => {}, linkSupabaseAccount: async () => { throw { code: 'auth_identity_conflict', message: 'RAW_ERROR_SENTINEL' }; } } }); linked.controller.handleInitialIssue('auth_user_not_linked'); assert.equal(linked.controller.getState().issue, 'auth_user_not_linked'); await linked.controller.linkExistingAccount('existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3'); assert.equal(linked.controller.getState().mode, 'otp-conflict'); assert.equal(linked.controller.getState().issue, 'auth_identity_conflict'); assert.equal(linked.controller.getState().error, '계정을 연결할 수 없습니다. 인증을 종료한 뒤 다시 시도해 주세요.'); assert.notEqual(initial.controller.getState().error, linked.controller.getState().error); assertNoLinkSensitiveData(linked.controller.getState(), linked.changes); }
async function assertLinkStaticContract() { const source = fs.readFileSync('apps/web-prototype/auth-controller.js', 'utf8'); assert.equal((source.match(/async function linkExistingAccount\s*\(/g) || []).length, 1); assert.equal((source.match(/계정을 연결할 수 없습니다\. 인증을 종료한 뒤 다시 시도해 주세요\./g) || []).length, 2); assert.equal((source.match(/계정을 연결하지 못했습니다\. 잠시 후 다시 시도해 주세요\./g) || []).length, 1); assert.equal((source.match(/현재 비밀번호 로그인과 다른 인증 계정입니다\. 인증을 종료한 뒤 다시 시도해 주세요\./g) || []).length, 1); assert.equal((source.match(/계정 연결에 실패했습니다|계정이 이미 연결되어 있습니다|계정 연결을 완료하지 못했습니다|controllerHelper|unusedAccountAction|unusedLinkExistingAccount|linkExistingAccountPrecise/g) || []).length, 0); }

async function assertLegacyCleanupByFailureStage() {
  const runCase = async stage => {
    const sequence = [];
    const counters = { login: 0, linkSupabaseAccount: 0, getCurrentUser: 0, loadServerData: 0, logoutLegacySession: 0, onAuthenticated: 0 };
    const cleanupStates = [];
    const t = setup({ sequence, dataStore: {
      login: async () => { counters.login += 1; sequence.push('login'); if (stage === 'login failure') throw { code: 'invalid_credentials', message: 'LOGIN_RAW_SENTINEL' }; },
      linkSupabaseAccount: async () => { counters.linkSupabaseAccount += 1; sequence.push('linkSupabaseAccount'); if (stage === 'linkSupabaseAccount failure') throw new Error('link failure raw'); },
      getCurrentUser: async () => { counters.getCurrentUser += 1; sequence.push('getCurrentUser'); if (stage === 'getCurrentUser failure') throw new Error('current user raw'); return { id: 'u' }; },
      loadServerData: async () => { counters.loadServerData += 1; sequence.push('loadServerData'); if (stage === 'loadServerData failure') throw new Error('server data raw'); return { places: [], collections: [] }; },
      logoutLegacySession: async () => { cleanupStates.push({ pending: t.controller.getState().pending, error: t.controller.getState().error }); counters.logoutLegacySession += 1; sequence.push('logoutLegacySession'); }
    }, onAuthenticated: () => { counters.onAuthenticated += 1; sequence.push('onAuthenticated'); } });
    t.controller.handleInitialIssue('auth_user_not_linked');
    await t.controller.linkExistingAccount('existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3');
    const state = t.controller.getState();
    assert.equal(state.mode, 'otp-unlinked');
    assert.equal(state.pending, false);
    assert.equal(state.issue, '');
    assert.equal(state.error, stage === 'login failure' ? '기존 계정의 이메일 또는 비밀번호를 확인해 주세요.' : '계정을 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    assertNoLinkSensitiveData(state, t.changes, ['existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3', ...(stage === 'login failure' ? ['LOGIN_RAW_SENTINEL'] : [stage === 'linkSupabaseAccount failure' ? 'link failure raw' : stage === 'getCurrentUser failure' ? 'current user raw' : 'server data raw'])]);
    const expectedSequence = stage === 'login failure' ? ['login'] : stage === 'linkSupabaseAccount failure' ? ['login', 'linkSupabaseAccount', 'logoutLegacySession'] : stage === 'getCurrentUser failure' ? ['login', 'linkSupabaseAccount', 'getCurrentUser', 'logoutLegacySession'] : ['login', 'linkSupabaseAccount', 'getCurrentUser', 'loadServerData', 'logoutLegacySession'];
    const expectedCounters = { login: 1, linkSupabaseAccount: stage === 'login failure' ? 0 : 1, getCurrentUser: stage === 'getCurrentUser failure' || stage === 'loadServerData failure' ? 1 : 0, loadServerData: stage === 'loadServerData failure' ? 1 : 0, logoutLegacySession: stage === 'login failure' ? 0 : 1, onAuthenticated: 0 };
    assert.deepEqual(sequence, expectedSequence); assert.deepEqual(counters, expectedCounters);
    if (stage !== 'login failure') assert.deepEqual(cleanupStates, [{ pending: true, error: '' }]);
    assert.equal(counters.logoutLegacySession, stage === 'login failure' ? 0 : 1);
    assert.equal(t.controller.getState().pending, false);
    assert.equal(t.controller.getState().issue, '');
    assert.equal(t.authenticated.length, 0);
    assertNoLinkSensitiveData(t.controller.getState(), t.changes, ['link failure raw', 'current user raw', 'server data raw']);
  };
  await runCase('login failure');
  await runCase('linkSupabaseAccount failure');
  await runCase('getCurrentUser failure');
  await runCase('loadServerData failure');

}

async function assertCleanupFailureCancelRetry() {
  let cleanupCalls = 0; let signOutCalls = 0; let authenticatedCalls = 0; const sequence = [];
  const t = setup({ sequence, onAuthenticated: () => { authenticatedCalls += 1; sequence.push('onAuthenticated'); }, dataStore: { login: async () => { sequence.push('login'); }, linkSupabaseAccount: async () => { sequence.push('linkSupabaseAccount'); throw new Error('LINK_RAW_SENTINEL'); }, logoutLegacySession: async () => { cleanupCalls += 1; sequence.push('logoutLegacySession'); if (cleanupCalls === 1) throw new Error('CLEANUP_RAW_SENTINEL'); } }, supabaseAuth: { signOut: async () => { signOutCalls += 1; sequence.push('signOut'); } } });
  t.controller.handleInitialIssue('auth_user_not_linked'); await t.controller.linkExistingAccount('existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3');
  assert.equal(authenticatedCalls, 0); assert.equal(t.authenticated.length, 0);
  assert.equal(cleanupCalls, 1); assert.equal(signOutCalls, 0); assert.equal(t.controller.getState().pending, false); assert.equal(t.controller.getState().mode, 'otp-unlinked'); assert.equal(t.controller.getState().issue, ''); assert.equal(t.controller.getState().error, '인증을 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.'); assertNoLinkSensitiveData(t.controller.getState(), t.changes, ['LINK_RAW_SENTINEL', 'CLEANUP_RAW_SENTINEL']);
  await t.controller.cancelOtp(); assert.equal(cleanupCalls, 2); assert.equal(signOutCalls, 1); assert.equal(authenticatedCalls, 0); assert.equal(t.authenticated.length, 0); assert.deepEqual(sequence, ['login', 'linkSupabaseAccount', 'logoutLegacySession', 'logoutLegacySession', 'signOut']); assert.deepEqual(plain(t.controller.getState()), { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' });
}

async function assertPartialCancelFailureLifecycle() {
  let cleanupCalls = 0; let signOutCalls = 0; const sequence = []; const counters = { login: 0, linkSupabaseAccount: 0, logoutLegacySession: 0, signOut: 0, onAuthenticated: 0 };
  const t = setup({ sequence, onAuthenticated: () => { counters.onAuthenticated += 1; sequence.push('onAuthenticated'); }, dataStore: { login: async () => { counters.login += 1; sequence.push('login'); }, linkSupabaseAccount: async () => { counters.linkSupabaseAccount += 1; sequence.push('linkSupabaseAccount'); throw new Error('LINK_RAW_SENTINEL'); }, logoutLegacySession: async () => { counters.logoutLegacySession += 1; sequence.push('logoutLegacySession'); cleanupCalls += 1; if (cleanupCalls === 1) throw new Error('CLEANUP_RAW_SENTINEL'); } }, supabaseAuth: { signOut: async () => { counters.signOut += 1; sequence.push('signOut'); signOutCalls += 1; if (signOutCalls === 1) throw new Error('SIGNOUT_RAW_SENTINEL'); } } });
  t.controller.handleInitialIssue('auth_user_not_linked');
  await t.controller.linkExistingAccount('existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3');
  assert.equal(cleanupCalls, 1); assert.equal(signOutCalls, 0); assert.equal(counters.onAuthenticated, 0);
  await t.controller.cancelOtp();
  const firstCancelState = t.controller.getState();
  assert.equal(cleanupCalls, 2); assert.equal(signOutCalls, 1); assert.equal(counters.logoutLegacySession, 2); assert.equal(counters.signOut, 1); assert.equal(counters.onAuthenticated, 0);
  assert.equal(firstCancelState.mode, 'otp-unlinked'); assert.equal(firstCancelState.pending, false); assert.equal(firstCancelState.issue, ''); assert.equal(firstCancelState.error, '인증을 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  assertNoLinkSensitiveData(firstCancelState, t.changes, ['existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3', 'LINK_RAW_SENTINEL', 'CLEANUP_RAW_SENTINEL', 'SIGNOUT_RAW_SENTINEL']);
  await t.controller.cancelOtp();
  assert.equal(cleanupCalls, 2); assert.equal(signOutCalls, 2); assert.equal(counters.logoutLegacySession, 2); assert.equal(counters.signOut, 2); assert.equal(counters.onAuthenticated, 0);
  assert.deepEqual(plain(t.controller.getState()), { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' });
  const expectedSequence = ['login', 'linkSupabaseAccount', 'logoutLegacySession', 'logoutLegacySession', 'signOut', 'signOut'];
  const expectedCounters = { login: 1, linkSupabaseAccount: 1, logoutLegacySession: 2, signOut: 2, onAuthenticated: 0 };
  assert.deepEqual(sequence, expectedSequence);
  assert.deepEqual(counters, expectedCounters);
}

async function assertSuccessfulLinkClearsCleanupFlag() {
  let cleanupCalls = 0; let signOutCalls = 0; let callbackState = null; const sequence = []; const counters = { login: 0, linkSupabaseAccount: 0, getCurrentUser: 0, loadServerData: 0, logoutLegacySession: 0, onAuthenticated: 0, signOut: 0 };
  const t = setup({ sequence, onAuthenticated: () => { counters.onAuthenticated += 1; sequence.push('onAuthenticated'); callbackState = t.controller.getState(); }, dataStore: { login: async () => { counters.login += 1; sequence.push('login'); }, linkSupabaseAccount: async () => { counters.linkSupabaseAccount += 1; sequence.push('linkSupabaseAccount'); }, getCurrentUser: async () => { counters.getCurrentUser += 1; sequence.push('getCurrentUser'); return { id: 'u' }; }, loadServerData: async () => { counters.loadServerData += 1; sequence.push('loadServerData'); return { places: [], collections: [] }; }, logoutLegacySession: async () => { counters.logoutLegacySession += 1; cleanupCalls += 1; } }, supabaseAuth: { signOut: async () => { counters.signOut += 1; signOutCalls += 1; } } });
  t.controller.handleInitialIssue('auth_user_not_linked'); await t.controller.linkExistingAccount('existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3'); const expectedSequence = ['login', 'linkSupabaseAccount', 'getCurrentUser', 'loadServerData', 'onAuthenticated']; const expectedCounters = { login: 1, linkSupabaseAccount: 1, getCurrentUser: 1, loadServerData: 1, logoutLegacySession: 0, onAuthenticated: 1, signOut: 0 }; assert.deepEqual(sequence, expectedSequence); assert.deepEqual(counters, expectedCounters); assert.equal(cleanupCalls, 0); assert.equal(callbackState.pending, false); assert.equal(callbackState.issue, ''); await t.controller.cancelOtp(); assert.equal(cleanupCalls, 0); assert.equal(signOutCalls, 1); assert.equal(t.controller.getState().mode, 'login');
  assert.deepEqual(plain(t.controller.getState()), { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' });
}

async function assertOrdinaryCancelSkipsLegacyCleanup() {
  let cleanupCalls = 0; let signOutCalls = 0; const t = setup({ dataStore: { logoutLegacySession: async () => { cleanupCalls += 1; } }, supabaseAuth: { signOut: async () => { signOutCalls += 1; } } });
  t.controller.setMode('otp-verify'); await t.controller.cancelOtp(); assert.equal(cleanupCalls, 0); assert.equal(signOutCalls, 1); assert.deepEqual(plain(t.controller.getState()), { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' });
}

async function assertCallbackFailureCleanup() {
  const makeDataStore = (counters, sequence) => ({
    login: async () => { counters.login += 1; sequence.push('login'); },
    linkSupabaseAccount: async () => { counters.linkSupabaseAccount += 1; sequence.push('linkSupabaseAccount'); },
    getCurrentUser: async () => { counters.getCurrentUser += 1; sequence.push('getCurrentUser'); return { id: 'callback-user' }; },
    loadServerData: async () => { counters.loadServerData += 1; sequence.push('loadServerData'); return { places: [], collections: [] }; },
    logoutLegacySession: async () => { counters.logoutLegacySession += 1; sequence.push('logoutLegacySession'); }
  });
  const runCase = async type => {
    const counters = { login: 0, linkSupabaseAccount: 0, getCurrentUser: 0, loadServerData: 0, logoutLegacySession: 0, onAuthenticated: 0, signOut: 0 }; const sequence = [];
    let callbackFailed = false;
    const t = setup({ sequence, dataStore: makeDataStore(counters, sequence), onChange: snapshot => { if (type === 'onChange' && !callbackFailed && snapshot.pending === false && snapshot.issue === '') { sequence.push('onChange'); callbackFailed = true; throw new Error('CALLBACK_RAW_SENTINEL'); } }, onAuthenticated: () => { counters.onAuthenticated += 1; sequence.push('onAuthenticated'); if (type === 'onAuthenticated') throw new Error('AUTHENTICATED_RAW_SENTINEL'); }, supabaseAuth: { signOut: async () => { counters.signOut += 1; sequence.push('signOut'); } } });
    t.controller.handleInitialIssue('auth_user_not_linked');
    const result = await t.controller.linkExistingAccount('existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3');
    assert.equal(result, null);
    assert.deepEqual(counters, type === 'onChange' ? { login: 1, linkSupabaseAccount: 1, getCurrentUser: 1, loadServerData: 1, logoutLegacySession: 1, onAuthenticated: 0, signOut: 0 } : { login: 1, linkSupabaseAccount: 1, getCurrentUser: 1, loadServerData: 1, logoutLegacySession: 1, onAuthenticated: 1, signOut: 0 });
    assert.equal(t.controller.getState().pending, false);
    assert.equal(t.controller.getState().issue, '');
    assert.equal(t.controller.getState().mode, 'otp-unlinked');
    assert.equal(t.controller.getState().error, '계정을 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    assert.ok(t.changes.length > 0);
    assertNoLinkSensitiveData(t.controller.getState(), t.changes, ['existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3', 'CALLBACK_RAW_SENTINEL', 'AUTHENTICATED_RAW_SENTINEL']);
    assert.deepEqual(sequence, type === 'onChange' ? ['login', 'linkSupabaseAccount', 'getCurrentUser', 'loadServerData', 'onChange', 'logoutLegacySession'] : ['login', 'linkSupabaseAccount', 'getCurrentUser', 'loadServerData', 'onAuthenticated', 'logoutLegacySession']);
    await t.controller.cancelOtp();
    assert.equal(counters.logoutLegacySession, 1);
    assert.equal(counters.signOut, 1);
    assert.deepEqual(sequence, type === 'onChange' ? ['login', 'linkSupabaseAccount', 'getCurrentUser', 'loadServerData', 'onChange', 'logoutLegacySession', 'signOut'] : ['login', 'linkSupabaseAccount', 'getCurrentUser', 'loadServerData', 'onAuthenticated', 'logoutLegacySession', 'signOut']);
    assert.deepEqual(plain(t.controller.getState()), { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' });
  };
  await runCase('onChange');
  await runCase('onAuthenticated');
}

async function run() {
  let t = setup();
  assert.deepEqual(Object.keys(t.api).sort(), ['create']);
  assert.deepEqual(Object.keys(t.controller).sort(), ['cancelOtp', 'getState', 'handleInitialIssue', 'linkExistingAccount', 'requestOtp', 'resendOtp', 'setMode', 'startGoogleOAuth', 'verifyOtp'].sort());
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
    shape.message = 'raw identity detail'; await t.controller.requestOtp('a@example.com'); await t.controller.verifyOtp('123456'); const state = t.controller.getState(); const issue = shape.error || shape.payload?.error || shape.code; assert.equal(state.mode, issue === 'auth_identity_conflict' ? 'otp-conflict' : 'otp-unlinked'); assert.equal(state.issue, issue); assert.equal(state.error, issue === 'auth_identity_conflict' ? '현재 비밀번호 로그인과 다른 인증 계정입니다. 인증을 종료한 뒤 다시 시도해 주세요.' : '이 인증 계정은 아직 여기였지 계정에 연결되지 않았습니다. 기존 이메일과 비밀번호로 로그인해 주세요.'); assert.equal(state.pending, false); assert.equal(JSON.stringify(state).includes('raw identity detail'), false); assert.equal(t.calls.some(c => c[0] === 'loadServerData'), false); assert.equal(t.authenticated.length, 0);
  }
  t = setup({ supabaseAuth: { requestEmailOtp: async () => ({ email: 'a@example.com' }), verifyEmailOtp: async () => { throw new Error('raw sdk verification detail'); }, signOut: async () => {} } }); await t.controller.requestOtp('a@example.com'); await t.controller.verifyOtp('bad'); assert.equal(t.controller.getState().mode, 'otp-verify'); assert.equal(t.controller.getState().error, '인증 코드가 올바르지 않거나 만료되었습니다.'); assert.equal(t.controller.getState().pending, false); assert.equal(JSON.stringify(t.controller.getState()).includes('raw sdk verification detail'), false); assert.equal(t.calls.some(c => c[0] === 'getCurrentUser'), false); assert.equal(t.calls.some(c => c[0] === 'loadServerData'), false); assert.equal(t.authenticated.length, 0);

  t = setup(); await t.controller.resendOtp(); assert.equal(t.calls.length, 0); assert.equal(t.controller.getState().error, '이메일 주소를 입력해 주세요.'); await t.controller.requestOtp('Original@Example.com'); await t.controller.resendOtp(); assert.equal(t.calls[1][1], 'original@example.com'); assert.equal(t.controller.getState().mode, 'otp-verify'); assert.equal(t.controller.getState().pending, false); assert.equal(t.controller.getState().notice, '인증 코드를 보냈습니다. 받은 편지함을 확인해 주세요.');
  let resolveResend; let resendCalls = 0; let resendPhase = false; t = setup({ supabaseAuth: { requestEmailOtp: async email => { resendCalls++; if (!resendPhase) { resendPhase = true; return { email }; } return new Promise(resolve => { resolveResend = () => resolve({ email }); }); }, verifyEmailOtp: async () => {}, signOut: async () => {} } }); await t.controller.requestOtp('normalized@example.com'); const resendOne = t.controller.resendOtp(); await Promise.resolve(); assert.equal(t.controller.getState().pending, true); const resendTwo = t.controller.resendOtp(); await Promise.resolve(); assert.equal(resendCalls, 2); resolveResend(); await resendOne; await resendTwo; assert.equal(t.controller.getState().pending, false); assert.equal(t.controller.getState().mode, 'otp-verify');
  t = setup(); t.controller.setMode('otp-verify'); await t.controller.cancelOtp(); assert.deepEqual(t.calls.map(c => c[0]), ['signOut']); assert.deepEqual(plain(t.controller.getState()), { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' });
  let signOutCalls = 0; t = setup({ supabaseAuth: { requestEmailOtp: async () => ({ email: 'a' }), verifyEmailOtp: async () => {}, signOut: async () => { signOutCalls++; throw new Error('raw signout detail'); } } }); t.controller.setMode('otp-verify'); await t.controller.cancelOtp(); assert.equal(signOutCalls, 1); assert.equal(t.calls.some(c => c[0] === 'logout'), false); assert.equal(t.controller.getState().error, '인증을 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.'); assert.equal(t.controller.getState().pending, false); assert.equal(JSON.stringify(t.controller.getState()).includes('raw signout detail'), false);
  let resolveSignOut; signOutCalls = 0; t = setup({ supabaseAuth: { requestEmailOtp: async () => ({ email: 'a' }), verifyEmailOtp: async () => {}, signOut: async () => { signOutCalls++; return new Promise(resolve => { resolveSignOut = resolve; }); } } }); t.controller.setMode('otp-verify'); const cancelOne = t.controller.cancelOtp(); await Promise.resolve(); assert.equal(t.controller.getState().pending, true); const cancelTwo = t.controller.cancelOtp(); await Promise.resolve(); assert.equal(signOutCalls, 1); resolveSignOut(); await cancelOne; await cancelTwo; assert.deepEqual(plain(t.controller.getState()), { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' }); assert.equal(t.calls.some(c => c[0] === 'logout'), false);
  t = setup(); t.controller.handleInitialIssue('auth_user_not_linked'); assert.equal(t.controller.getState().mode, 'otp-unlinked'); assert.equal(t.controller.getState().issue, 'auth_user_not_linked'); assert.equal(t.controller.getState().error, '이 인증 계정은 아직 여기였지 계정에 연결되지 않았습니다. 기존 이메일과 비밀번호로 로그인해 주세요.'); assert.equal(t.controller.getState().pending, false); const count = t.changes.length; t.controller.handleInitialIssue('auth_identity_conflict'); assert.equal(t.controller.getState().mode, 'otp-conflict'); assert.equal(t.controller.getState().issue, 'auth_identity_conflict'); assert.equal(t.controller.getState().error, '현재 비밀번호 로그인과 다른 인증 계정입니다. 인증을 종료한 뒤 다시 시도해 주세요.'); assert.equal(t.controller.getState().pending, false); const beforeUnknown = plain(t.controller.getState()); const afterKnown = t.changes.length; t.controller.handleInitialIssue('unknown'); assert.deepEqual(plain(t.controller.getState()), beforeUnknown); assert.equal(t.changes.length, afterKnown); assert.ok(afterKnown > count);
  for (const change of t.changes) assertNoSensitiveState(change);
  let googleCalls = 0; let resolveGoogle; t = setup({ supabaseAuth: { requestEmailOtp: async () => ({ email: 'a@example.com' }), verifyEmailOtp: async () => {}, signOut: async () => {}, signInWithGoogle: async () => { googleCalls += 1; return { started: true }; } } });
  const googleResult = await t.controller.startGoogleOAuth(); assert.deepEqual(googleResult, { started: true }); assert.equal(googleCalls, 1); assert.equal(t.controller.getState().pending, false); assert.equal(t.controller.getState().notice, 'Google 로그인 화면으로 이동합니다.');
  t.controller.setMode('register'); await t.controller.startGoogleOAuth(); assert.equal(googleCalls, 1);
  let pendingGoogleCalls = 0; t = setup({ supabaseAuth: { requestEmailOtp: async () => ({ email: 'a@example.com' }), verifyEmailOtp: async () => {}, signOut: async () => {}, signInWithGoogle: async () => { pendingGoogleCalls += 1; return new Promise(resolve => { resolveGoogle = resolve; }); } } });
  const googleOne = t.controller.startGoogleOAuth(); await Promise.resolve(); assert.equal(t.controller.getState().pending, true); assert.ok(t.changes.some(snapshot => snapshot.pending === true)); const googleTwo = t.controller.startGoogleOAuth(); await Promise.resolve(); assert.equal(pendingGoogleCalls, 1); resolveGoogle({ started: true }); await googleOne; await googleTwo; assert.equal(t.controller.getState().pending, false);
  t = setup({ supabaseAuth: { requestEmailOtp: async () => ({ email: 'a@example.com' }), verifyEmailOtp: async () => {}, signOut: async () => {}, signInWithGoogle: async () => { throw new Error('raw google detail'); } } }); await t.controller.startGoogleOAuth(); assert.equal(t.controller.getState().error, 'Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'); assert.equal(JSON.stringify(t.controller.getState()).includes('raw google detail'), false);
  await assertLinkModeRestrictions();
  await assertLinkSuccessSequence();
  await assertLinkPendingGuard();
  await assertLinkErrorMappings();
  await assertLegacyCleanupByFailureStage();
  await assertCleanupFailureCancelRetry();
  await assertPartialCancelFailureLifecycle();
  await assertSuccessfulLinkClearsCleanupFlag();
  await assertOrdinaryCancelSkipsLegacyCleanup();
  await assertCallbackFailureCleanup();

  await assertInitialAndLinkConflictDiffer();
  await assertLinkStaticContract();
  console.log('Auth controller tests passed: isolated API, modes, OTP, Google OAuth, errors, pending guards, cancel, linking, and snapshots');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
