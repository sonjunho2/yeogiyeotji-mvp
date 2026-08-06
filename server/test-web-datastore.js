'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('apps/web-prototype/data-store.js', 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function createContext(location, responses, auth = {}) {
  const values = new Map();
  const calls = [];
  const optionsLog = [];
  const fetch = async (path, options) => {
    calls.push(path);
    optionsLog.push({ path, options });
    const queued = responses[path]; const response = Array.isArray(queued) ? queued.shift() : queued;
    if (!response) throw new Error(`TEST_RESPONSE_MISSING:${path}`);
    if (response instanceof Error) throw response;
    return { ok: response.ok, status: response.status, text: async () => response.body };
  };
  class AbortController { constructor() { this.signal = {}; } abort() {} }
  const context = {
    window: {},
    location,
    localStorage: { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value) },
    fetch,
    setTimeout: () => 1,
    clearTimeout: () => {},
    AbortController,
    console: { error: () => {} }
  };
  let initializedConfig = null;
  let initializeCalls = 0;
  let accessTokenCount = 0;
  let signOutCount = 0;
  context.window.YYJSupabaseAuth = { initialize: config => { initializeCalls += 1; if (typeof auth.initialize === 'function') auth.initialize(config, initializeCalls); else if (auth.initializeError) throw auth.initializeError; initializedConfig = config; }, getAccessToken: async () => { accessTokenCount += 1; return auth.getAccessToken ? auth.getAccessToken() : null; }, signOut: async () => { signOutCount += 1; if (auth.signOut) return auth.signOut(); } };
  vm.runInNewContext(source, context, { filename: 'data-store.js' });
  return { store: context.window.YYJDataStore, calls, values, optionsLog, getInitializedConfig: () => initializedConfig, getInitializeCalls: () => initializeCalls, getAccessTokenCount: () => accessTokenCount, getSignOutCount: () => signOutCount };
}

const seeds = {
  places: [{ id: 'seed-place', name: 'Seed place', category: 'test', latitude: 1, longitude: 2 }],
  collections: [{ id: 'seed-collection', name: 'Seed collection', privacy: 'private' }]
};
const ok = body => ({ ok: true, status: 200, body: JSON.stringify(body) });
const unauthorized = { ok: false, status: 401, body: JSON.stringify({ message: 'unauthorized' }) };

async function assertRenderHttps() {
  const { store, calls } = createContext({ protocol: 'https:', hostname: 'yeogiyeotji-mvp.onrender.com' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: false } }), '/api/auth/me': unauthorized });
  const result = await store.initialize(seeds.places, seeds.collections);
  assert.equal(result.mode, 'server');
  assert.equal(result.fallback, false);
  assert.equal(result.authRequired, true);
  assert.equal(result.places.length, 0);
  assert.equal(result.collections.length, 0);
  assert.deepEqual(calls, ['/api/health', '/api/auth/config', '/api/auth/me']);
}

async function assertLocalhost() {
  const { store } = createContext({ protocol: 'http:', hostname: 'localhost' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: false } }), '/api/auth/me': unauthorized });
  const result = await store.initialize([], []);
  assert.equal(result.mode, 'server');
  assert.equal(result.fallback, false);
  assert.equal(result.authRequired, true);
}

async function assertStaticHttpsFallback() {
  const { store, values, calls } = createContext({ protocol: 'https:', hostname: 'sonjunho2.github.io' }, { '/api/health': { ok: false, status: 404, body: '<!doctype html>' } });
  const result = await store.initialize(seeds.places, seeds.collections);
  assert.equal(result.mode, 'browser');
  assert.equal(result.fallback, true);
  assert.deepEqual(Array.from(result.places, item => item.id), ['seed-place']);
  assert.deepEqual(Array.from(result.collections, item => item.id), ['seed-collection']);
  assert.ok(values.has('yyj_places'));
  assert.ok(values.has('yyj_collections'));
  assert.deepEqual(calls, ['/api/health']);
}

async function assertFileProtocol() {
  const { store, calls } = createContext({ protocol: 'file:', hostname: '' }, {});
  const result = await store.initialize(seeds.places, seeds.collections);
  assert.equal(result.mode, 'browser');
  assert.equal(result.fallback, false);
  assert.deepEqual(Array.from(result.places, item => item.id), ['seed-place']);
  assert.deepEqual(Array.from(result.collections, item => item.id), ['seed-collection']);
  assert.deepEqual(calls, []);
}

async function assertBearerAndAuthErrors() {
  const tokenContext = createContext({ protocol: 'https:', hostname: 'example.test' }, {
    '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }), '/api/auth/me': ok({ item: { id: 'u' } }), '/api/places': ok({ items: [] }), '/api/collections': ok({ items: [] })
  }, { getAccessToken: async () => 'test-token' });
  await tokenContext.store.initialize([], []);
  const protectedCalls = tokenContext.optionsLog.filter(item => ['/api/auth/me', '/api/places', '/api/collections'].includes(item.path));
  assert.ok(protectedCalls.every(item => item.options.headers.Authorization === 'Bearer test-token'));
  assert.equal(tokenContext.optionsLog.find(item => item.path === '/api/health').options.headers.Authorization, undefined);
  const errorContext = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }) }, { getAccessToken: async () => { const error = new Error('hidden'); error.code = 'SUPABASE_AUTH_STATE_ERROR'; throw error; } });
  await assert.rejects(errorContext.store.initialize([], []), error => error.code === 'SUPABASE_AUTH_STATE_ERROR');
  assert.deepEqual(errorContext.calls, ['/api/health', '/api/auth/config']);
}

async function assertAuthIssuesAndConfig() {
  const linked = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true, emailOtpEnabled: true } }), '/api/auth/me': { ok: false, status: 409, body: JSON.stringify({ error: 'auth_identity_conflict', message: 'conflict' }) } });
  const result = await linked.store.initialize([], []);
  assert.equal(result.authRequired, true); assert.equal(result.authIssue, 'auth_identity_conflict'); assert.equal(linked.getInitializedConfig().emailOtpEnabled, true);
}

async function assertAuthIssueVariants() {
  for (const [body, issue] of [
    [{ error: 'auth_user_not_linked', message: 'not linked' }, 'auth_user_not_linked'],
    [{ error: 'invalid_token', message: 'invalid' }, 'invalid_token'],
    [{ message: 'authentication required' }, 'unauthorized']
  ]) {
    const context = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true, emailOtpEnabled: false, supabaseUrl: 'https://project.supabase.co', publishableKey: 'sb_publishable_test' } }), '/api/auth/me': { ok: false, status: 401, body: JSON.stringify(body) } });
    const result = await context.store.initialize([], []); assert.equal(result.authRequired, true); assert.equal(result.authIssue, issue); assert.equal(result.user, null); assert.deepEqual(plain(result.places), []); assert.deepEqual(plain(result.collections), []); assert.equal(context.store.getMode(), 'server'); assert.equal(context.store.isFallback(), false); assert.deepEqual(context.calls, ['/api/health', '/api/auth/config', '/api/auth/me']);
  }
}

async function assertConflictClassification() {
  const authConflict = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }), '/api/auth/me': { ok: false, status: 409, body: JSON.stringify({ error: 'auth_identity_conflict', message: 'conflict' }) } });
  const result = await authConflict.store.initialize([], []); assert.equal(result.authRequired, true); assert.equal(result.authIssue, 'auth_identity_conflict'); assert.equal(authConflict.store.isFallback(), false); assert.deepEqual(authConflict.calls, ['/api/health', '/api/auth/config', '/api/auth/me']);
  const ordinaryRequest = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }), '/api/auth/me': [ok({ item: { id: 'u' } }), { ok: false, status: 409, body: JSON.stringify({ error: 'ordinary_conflict', message: 'ordinary conflict' }) }], '/api/places': ok({ items: [] }), '/api/collections': ok({ items: [] }) }); await ordinaryRequest.store.initialize([], []); await assert.rejects(ordinaryRequest.store.getCurrentUser(), error => error.name !== 'AuthenticationError' && error.status === 409 && error.payload.error === 'ordinary_conflict');
}

async function assertAuthenticationErrorShape() {
  const payload = { error: 'auth_user_not_linked', message: 'not linked' };
  const context = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }), '/api/auth/me': [ok({ item: { id: 'user-1' } }), { ok: false, status: 401, body: JSON.stringify(payload) }], '/api/places': ok({ items: [] }), '/api/collections': ok({ items: [] }) });
  await context.store.initialize([], []);
  await assert.rejects(context.store.getCurrentUser(), error => error.name === 'AuthenticationError' && error.status === 401 && error.message === 'not linked' && JSON.stringify(error.payload) === JSON.stringify(payload) && error.response === undefined && error.request === undefined && error.token === undefined && error.accessToken === undefined && !JSON.stringify(error).includes('access token') && !String(error).includes('access token'));

  const ordinary = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }), '/api/auth/me': [ok({ item: { id: 'user-1' } }), { ok: false, status: 400, body: JSON.stringify({ error: 'bad_request', message: 'bad request' }) }] });
  await ordinary.store.initialize([], []);
  await assert.rejects(ordinary.store.getCurrentUser(), error => error.name !== 'AuthenticationError' && error.status === 400 && error.message === 'bad request' && error.payload.error === 'bad_request');
}

async function assertConfigForwarding() {
  for (const emailOtpEnabled of [true, false]) {
    const item = { enabled: true, emailOtpEnabled, supabaseUrl: 'https://project.supabase.co', publishableKey: 'sb_publishable_test' }; const original = { ...item };
    const context = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item }), '/api/auth/me': ok({ item: { id: 'u' } }), '/api/places': ok({ items: [] }), '/api/collections': ok({ items: [] }) }); await context.store.initialize([], []); assert.deepEqual(plain(context.getInitializedConfig()), original); assert.deepEqual(item, original);
  }
}

async function assertBearerRules() {
  const withToken = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }), '/api/auth/me': ok({ item: { id: 'u' } }), '/api/places': ok({ items: [] }), '/api/collections': ok({ items: [] }), '/api/auth/register': ok({ item: { id: 'r' } }), '/api/auth/login': ok({ item: { id: 'l' } }), '/api/auth/logout': ok({ ok: true }) }, { getAccessToken: async () => 'bearer-test-token' }); await withToken.store.initialize([], []); for (const path of ['/api/auth/me', '/api/places', '/api/collections']) { const entry = withToken.optionsLog.find(item => item.path === path); assert.equal(entry.options.credentials, 'same-origin'); assert.equal(entry.options.headers.Authorization, 'Bearer bearer-test-token'); } for (const path of ['/api/health', '/api/auth/config']) assert.equal(withToken.optionsLog.find(item => item.path === path).options.headers.Authorization, undefined); await withToken.store.register({ email: 'a', password: 'b' }); await withToken.store.login({ email: 'a', password: 'b' }); await withToken.store.logout(); for (const path of ['/api/auth/register', '/api/auth/login', '/api/auth/logout']) assert.equal(withToken.optionsLog.find(item => item.path === path).options.headers.Authorization, undefined);
  const withoutToken = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }), '/api/auth/me': ok({ item: { id: 'u' } }), '/api/places': ok({ items: [] }), '/api/collections': ok({ items: [] }) }); await withoutToken.store.initialize([], []); for (const path of ['/api/auth/me', '/api/places', '/api/collections']) assert.equal(Object.prototype.hasOwnProperty.call(withoutToken.optionsLog.find(item => item.path === path).options.headers, 'Authorization'), false);
}

async function assertFallbackErrors() {
  for (const code of ['SUPABASE_AUTH_CONFIG_ERROR', 'SUPABASE_AUTH_STATE_ERROR']) { const error = new Error('raw auth detail'); error.code = code; const context = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }) }, { initializeError: error }); await assert.rejects(context.store.initialize([], []), received => received.code === code); assert.equal(context.store.getMode(), 'browser'); assert.equal(context.store.isFallback(), false); assert.deepEqual(context.calls, ['/api/health', '/api/auth/config']); assert.equal(context.values.size, 0); }
}

async function assertLogoutOutcomes() {
  const base = { '/api/auth/logout': ok({ ok: true }) };
  const success = createContext({ protocol: 'https:', hostname: 'example.test' }, base);
  await success.store.logout();
  assert.equal(success.calls.filter(path => path === '/api/auth/logout').length, 1);
  assert.equal(success.getSignOutCount(), 1);
  const serverFailure = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/auth/logout': new Error('raw server logout') });
  await assert.rejects(serverFailure.store.logout(), error => { assert.equal(error.code, 'LOGOUT_FAILED'); assert.equal(error.message.includes('raw server logout'), false); assert.equal(JSON.stringify(error).includes('raw server logout'), false); return true; });
  assert.equal(serverFailure.calls.filter(path => path === '/api/auth/logout').length, 1);
  assert.equal(serverFailure.getSignOutCount(), 1);
  const supabaseFailure = createContext({ protocol: 'https:', hostname: 'example.test' }, base, { signOut: async () => { throw new Error('raw supabase logout'); } });
  await assert.rejects(supabaseFailure.store.logout(), error => { assert.equal(error.code, 'LOGOUT_FAILED'); assert.equal(error.message.includes('raw supabase logout'), false); assert.equal(JSON.stringify(error).includes('raw supabase logout'), false); return true; });
  assert.equal(supabaseFailure.calls.filter(path => path === '/api/auth/logout').length, 1);
  assert.equal(supabaseFailure.getSignOutCount(), 1);
  const bothFailure = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/auth/logout': new Error('raw server') }, { signOut: async () => { throw new Error('raw supabase'); } });
  await assert.rejects(bothFailure.store.logout(), error => { assert.equal(error.code, 'LOGOUT_FAILED'); assert.equal(error.message.includes('raw server'), false); assert.equal(error.message.includes('raw supabase'), false); assert.equal(JSON.stringify(error).includes('raw server'), false); assert.equal(JSON.stringify(error).includes('raw supabase'), false); return true; });
  assert.equal(bothFailure.calls.filter(path => path === '/api/auth/logout').length, 1);
  assert.equal(bothFailure.getSignOutCount(), 1);
}

async function assertLogoutLegacySessionContract() {
  const context = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/auth/logout': ok({ ok: true }) });
  assert.equal(typeof context.store.logoutLegacySession, 'function');
  await context.store.logoutLegacySession();
  assert.deepEqual(context.calls, ['/api/auth/logout']);
  const request = context.optionsLog[0];
  assert.equal(request.path, '/api/auth/logout'); assert.equal(request.options.method, 'POST'); assert.equal(request.options.body, '{}'); assert.equal(Object.prototype.hasOwnProperty.call(request.options.headers, 'Authorization'), false); assert.equal(context.getAccessTokenCount(), 0); assert.equal(context.getSignOutCount(), 0);
  const source = fs.readFileSync('apps/web-prototype/data-store.js', 'utf8');
  assert.equal((source.match(/async function logoutLegacySession\s*\(/g) || []).length, 1);
  const legacyBody = source.slice(source.indexOf('async function logoutLegacySession'), source.indexOf('\n  async function logout()', source.indexOf('async function logoutLegacySession')));
  assert.equal(legacyBody.includes("'/api/auth/logout'"), true); assert.equal(legacyBody.includes("method: 'POST'"), true); assert.equal(legacyBody.includes("body: '{}'"), true); assert.equal(legacyBody.includes('useBearer: false'), true); assert.equal(legacyBody.includes('signOut'), false);
  const publicApiStart = source.indexOf('window.YYJDataStore = {'); const publicApiEnd = source.indexOf('};', publicApiStart); const publicApiBody = source.slice(publicApiStart, publicApiEnd); assert.equal((publicApiBody.match(/\blogoutLegacySession\b/g) || []).length, 1);
  const logoutBody = source.slice(source.indexOf('async function logout()'), source.indexOf('\n  async function getCurrentUser'));
  assert.equal(logoutBody.includes("request('/api/auth/logout"), false); assert.equal(logoutBody.includes('logoutLegacySession()'), true); assert.equal(logoutBody.includes('Promise.allSettled'), true); assert.equal(logoutBody.includes('YYJSupabaseAuth.signOut'), true);
}

async function assertPass15MissingCoverage() {
  const assertHiddenAuthError = async (context, expectedStatus, payload, token) => {
    await assert.rejects(context.store.getCurrentUser(), error => error.name === 'AuthenticationError' && error.status === expectedStatus && error.message === payload.message && JSON.stringify(error.payload) === JSON.stringify(payload) && !Object.prototype.hasOwnProperty.call(error, 'response') && !Object.prototype.hasOwnProperty.call(error, 'request') && !Object.prototype.hasOwnProperty.call(error, 'token') && !Object.prototype.hasOwnProperty.call(error, 'accessToken') && !String(error).includes(token) && !JSON.stringify(error).includes(token));
  };
  const conflictPayload = { error: 'auth_identity_conflict', message: 'conflict' };
  const conflict = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }), '/api/auth/me': [ok({ item: { id: 'u' } }), { ok: false, status: 409, body: JSON.stringify(conflictPayload) }], '/api/places': ok({ items: [] }), '/api/collections': ok({ items: [] }) }, { getAccessToken: async () => 'shape-conflict-token' });
  await conflict.store.initialize([], []);
  await assertHiddenAuthError(conflict, 409, conflictPayload, 'shape-conflict-token');
  assert.equal(conflict.store.getMode(), 'server'); assert.equal(conflict.store.isFallback(), false);

  for (const [status, payload] of [[409, { error: 'ordinary_conflict', message: 'ordinary conflict' }], [400, { error: 'bad_request', message: 'bad request' }], [500, { error: 'server_error', message: 'server error' }]]) {
    const context = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }), '/api/auth/me': [ok({ item: { id: 'u' } }), { ok: false, status, body: JSON.stringify(payload) }] });
    await context.store.initialize([], []);
    await assert.rejects(context.store.getCurrentUser(), error => error.name !== 'AuthenticationError' && error.status === status && error.message === payload.message && JSON.stringify(error.payload) === JSON.stringify(payload) && error.authIssue === undefined);
  }

  const api = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }), '/api/auth/me': ok({ item: { id: 'u' } }), '/api/places': ok({ items: [] }), '/api/collections': ok({ items: [] }), '/api/auth/register': ok({ item: { id: 'r' } }), '/api/auth/login': ok({ item: { id: 'l' } }), '/api/auth/logout': ok({ ok: true }) }, { getAccessToken: async () => 'public-api-token' });
  await api.store.initialize([], []); const baseline = api.getAccessTokenCount();
  await api.store.register({ email: 'register@example.com', password: 'register-password' }); assert.equal(api.getAccessTokenCount(), baseline);
  await api.store.login({ email: 'login@example.com', password: 'login-password' }); assert.equal(api.getAccessTokenCount(), baseline);
  await api.store.logout(); assert.equal(api.getAccessTokenCount(), baseline);
  for (const [path, input] of [['/api/auth/register', { email: 'register@example.com', password: 'register-password' }], ['/api/auth/login', { email: 'login@example.com', password: 'login-password' }]]) {
    const entry = api.optionsLog.find(item => item.path === path); assert.equal(entry.options.method, 'POST'); assert.equal(entry.options.credentials, 'same-origin'); assert.equal(entry.options.headers['content-type'], 'application/json'); assert.equal(entry.options.headers.Authorization, undefined); assert.deepEqual(JSON.parse(entry.options.body), input);
  }
  const logoutRequest = api.optionsLog.find(item => item.path === '/api/auth/logout'); assert.equal(logoutRequest.options.method, 'POST'); assert.equal(logoutRequest.options.headers.Authorization, undefined);

  const logoutMessage = '로그아웃을 완료하지 못했습니다.';
  for (const context of [createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/auth/logout': new Error('raw server logout') }), createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/auth/logout': ok({ ok: true }) }, { signOut: async () => { throw new Error('raw supabase logout'); } }), createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/auth/logout': new Error('raw server') }, { signOut: async () => { throw new Error('raw supabase'); } })]) {
    await assert.rejects(context.store.logout(), error => error.code === 'LOGOUT_FAILED' && error.message === logoutMessage && !String(error).includes('raw') && !JSON.stringify(error).includes('raw'));
  }

  for (const code of ['SUPABASE_AUTH_CONFIG_ERROR', 'SUPABASE_AUTH_STATE_ERROR']) {
    let throwOn = 2; const context = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': [ok({ ok: true }), ok({ ok: true })], '/api/auth/config': [ok({ item: { enabled: true } }), ok({ item: { enabled: true } })], '/api/auth/me': [ok({ item: { id: 'u' } }), ok({ item: { id: 'u' } })], '/api/places': [ok({ items: [] }), ok({ items: [] })], '/api/collections': [ok({ items: [] }), ok({ items: [] })] }, { initialize: (config, count) => { if (count === throwOn) { const error = new Error('raw'); error.code = code; throw error; } } });
    const first = await context.store.initialize(seeds.places, seeds.collections); assert.equal(first.mode, 'server'); assert.equal(first.fallback, false); await assert.rejects(context.store.initialize(seeds.places, seeds.collections), error => error.code === code); assert.equal(context.store.getMode(), 'server'); assert.equal(context.store.isFallback(), false); assert.equal(context.values.has('yyj_places'), false); assert.equal(context.values.has('yyj_collections'), false);
  }

  let failed = false; const tokenContext = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/health': ok({ ok: true }), '/api/auth/config': ok({ item: { enabled: true } }), '/api/auth/me': ok({ item: { id: 'u' } }), '/api/places': ok({ items: [] }), '/api/collections': ok({ items: [] }) }, { getAccessToken: async () => { if (failed) { const error = new Error('raw'); error.code = 'SUPABASE_AUTH_STATE_ERROR'; throw error; } return null; } }); await tokenContext.store.initialize([], []); failed = true; await assert.rejects(tokenContext.store.getCurrentUser(), error => error.code === 'SUPABASE_AUTH_STATE_ERROR'); assert.equal(tokenContext.store.getMode(), 'server'); assert.equal(tokenContext.store.isFallback(), false);
}

async function assertSupabaseLinkRequest() {
  const context = createContext({ protocol: 'https:', hostname: 'example.test' }, { '/api/auth/link-supabase': ok({ item: { id: 'u' }, idempotent: true }) }, { getAccessToken: async () => 'JWT_SECRET_SENTINEL_5_3' });
  const result = await context.store.linkSupabaseAccount('PASSWORD_SECRET_SENTINEL_5_3');
  assert.equal(JSON.stringify(result), JSON.stringify({ item: { id: 'u' }, idempotent: true }));
  assert.equal(context.getAccessTokenCount(), 1);
  const request = context.optionsLog[0];
  assert.equal(request.path, '/api/auth/link-supabase');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.headers['content-type'], 'application/json');
  assert.equal(request.options.headers.Authorization, 'Bearer JWT_SECRET_SENTINEL_5_3');
  assert.deepEqual(JSON.parse(request.options.body), { password: 'PASSWORD_SECRET_SENTINEL_5_3' });
}

(async () => {
  await assertRenderHttps();
  await assertLocalhost();
  await assertStaticHttpsFallback();
  await assertFileProtocol();
  await assertBearerAndAuthErrors();
  await assertAuthIssuesAndConfig();
  await assertAuthIssueVariants();
  await assertConflictClassification();
  await assertAuthenticationErrorShape();
  await assertConfigForwarding();
  await assertBearerRules();
  await assertFallbackErrors();
  await assertLogoutOutcomes();
  await assertLogoutLegacySessionContract();
  await assertPass15MissingCoverage();
  await assertSupabaseLinkRequest();
  console.log('Web datastore tests passed: Render HTTPS, localhost, static HTTPS fallback, and file protocol');
})().catch(error => { console.error(`Web datastore tests failed: ${error.message}`); process.exitCode = 1; });
