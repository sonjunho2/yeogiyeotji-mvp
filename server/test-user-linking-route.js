'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJsonStorage } = require('./storage/json-storage');
const { hashPassword } = require('./auth/password');
const { resolveSupabaseUserLinkResponse } = require('./auth/user-linking-route');

const ORIGIN = 'https://app.example.test';
const AUTH_ID = '11111111-1111-4111-8111-111111111111';

function assertOutcome(outcome, status, error, message) {
  assert.deepEqual(outcome, { status, payload: { error, message } });
  noSecrets(outcome.payload);
}

async function createHarness() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yyj-user-linking-route-'));
  const storage = createJsonStorage(path.join(directory, 'store.json'));
  const password = 'password-A';
  const user = { id: 'user-a', email: 'a@example.test', displayName: 'A', ...hashPassword(password), authUserId: null, createdAt: new Date().toISOString() };
  await storage.createUser(user);
  const sessionToken = 'SESSION_SECRET_SENTINEL_5_2';
  await storage.createSession({ tokenHash: crypto.createHash('sha256').update(sessionToken).digest('hex'), userId: user.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const url = new URL(`${ORIGIN}/api/auth/link-supabase`);
  const request = (options = {}) => {
    const origin = Object.prototype.hasOwnProperty.call(options, 'origin') ? options.origin : ORIGIN;
    const authorization = Object.prototype.hasOwnProperty.call(options, 'authorization') ? options.authorization : 'Bearer JWT_SECRET_SENTINEL_5_2';
    const body = Object.prototype.hasOwnProperty.call(options, 'body') ? options.body : { password };
    const requestSessionToken = Object.prototype.hasOwnProperty.call(options, 'sessionToken') ? options.sessionToken : sessionToken;
    const method = options.method || 'POST';
    return { method, headers: { origin, authorization, cookie: requestSessionToken ? `yyj_session=${encodeURIComponent(requestSessionToken)}` : undefined }, body };
  };
  const verifier = async token => { assert.equal(token, 'JWT_SECRET_SENTINEL_5_2'); return { authUserId: AUTH_ID, internalClaim: 'CLAIM_SECRET_SENTINEL_5_2' }; };
  const cleanup = async () => fs.rm(directory, { recursive: true, force: true });
  return { directory, storage, user, password, sessionToken, url, request, verifier, cleanup };
}

async function resolve(h, options = {}, overrides = {}) {
  let readBodyCalls = 0;
  const outcome = await resolveSupabaseUserLinkResponse({ req: h.request(options), url: h.url, storage: h.storage, jwtVerifier: h.verifier, readBody: async req => { readBodyCalls += 1; return req.body; }, ...overrides });
  return { outcome, readBodyCalls };
}

function noSecrets(value) {
  const text = JSON.stringify(value);
  for (const secret of ['password-A', 'PASSWORD_SECRET_SENTINEL_5_2', 'JWT_SECRET_SENTINEL_5_2', 'SESSION_SECRET_SENTINEL_5_2', 'CLAIM_SECRET_SENTINEL_5_2', 'RAW_JWT_INTERNAL_SENTINEL_5_2', 'RAW_DATABASE_SENTINEL_5_2', 'passwordHash', 'passwordSalt', 'authUserId', 'accessToken', 'refreshToken', 'providerToken', 'claims', 'sessionToken', 'tokenHash']) assert.equal(text.includes(secret), false, secret);
}

async function testSuccessfulRouteResponse() {
  const h = await createHarness();
  try {
    let verifyCalls = 0; let linkCalls = 0;
    const storage = new Proxy(h.storage, { get(target, property, receiver) { if (property === 'linkUserToAuthUser') return async (...args) => { linkCalls += 1; return target.linkUserToAuthUser(...args); }; return Reflect.get(target, property, receiver); } });
    const { outcome, readBodyCalls } = await resolve(h, {}, { storage, jwtVerifier: async token => { verifyCalls += 1; return h.verifier(token); } });
    assert.equal(outcome.status, 200); assert.equal(outcome.payload.item.id, h.user.id); assert.equal(outcome.payload.idempotent, false); assert.equal(readBodyCalls, 1); noSecrets(outcome.payload);
    assert.equal(verifyCalls, 1); assert.equal(linkCalls, 1);
    assert.equal((await h.storage.findUserById(h.user.id)).authUserId, AUTH_ID);
    assert.equal((await h.storage.findSessionByTokenHash(crypto.createHash('sha256').update(h.sessionToken).digest('hex'))).userId, h.user.id);
  } finally { await h.cleanup(); }
}

async function testIdempotentRouteResponse() {
  const h = await createHarness();
  try { await resolve(h); const { outcome } = await resolve(h); assert.equal(outcome.status, 200); assert.equal(outcome.payload.idempotent, true); assert.equal((await h.storage.load()).users.length, 1); noSecrets(outcome.payload); } finally { await h.cleanup(); }
}

async function testOriginRequirements() {
  for (const origin of [undefined, 'null', 'http://app.example.test', 'https://other.example.test', 'https://app.example.test:443', `${ORIGIN}, ${ORIGIN}`, `${ORIGIN}/suffix`]) {
    const h = await createHarness();
    try {
      let verifierCalls = 0; let linkCalls = 0;
      const storage = new Proxy(h.storage, { get(target, property, receiver) { if (property === 'linkUserToAuthUser') return async (...args) => { linkCalls += 1; return target.linkUserToAuthUser(...args); }; return Reflect.get(target, property, receiver); } });
      const { outcome, readBodyCalls } = await resolve(h, { origin }, { storage, jwtVerifier: async token => { verifierCalls += 1; return h.verifier(token); } });
      if (readBodyCalls === 0) { assert.equal(verifierCalls, 0); assert.equal(linkCalls, 0); assert.equal((await h.storage.load()).users.length, 1); }
      assertOutcome(outcome, 403, 'invalid_origin', '허용되지 않은 요청 출처입니다.'); assert.equal(readBodyCalls, 0); assert.equal((await h.storage.findUserById(h.user.id)).authUserId, null); noSecrets(outcome.payload);
    } finally { await h.cleanup(); }
  }
  const h = await createHarness();
  try {
    let verifierCalls = 0; let linkCalls = 0;
    const storage = new Proxy(h.storage, { get(target, property, receiver) { if (property === 'linkUserToAuthUser') return async (...args) => { linkCalls += 1; return target.linkUserToAuthUser(...args); }; return Reflect.get(target, property, receiver); } });
    const result = await resolve(h, {}, { storage, jwtVerifier: async token => { verifierCalls += 1; return h.verifier(token); } });
    assert.equal(result.outcome.status, 200); assert.equal(result.readBodyCalls, 1); assert.equal(verifierCalls, 1); assert.equal(linkCalls, 1);
  } finally { await h.cleanup(); }
}

async function testBodyValidation() {
  for (const body of [null, [], 'password', {}, { password: undefined }, { password: 'x'.repeat(129) }]) {
    const h = await createHarness();
    try { const { outcome } = await resolve(h, { body }); assertOutcome(outcome, 400, 'validation_error', '요청 형식이 올바르지 않습니다.'); noSecrets(outcome.payload); } finally { await h.cleanup(); }
  }
  const h = await createHarness();
  try {
    const body = { password: h.password, email: 'attacker@example.test', authUserId: '33333333-3333-4333-8333-333333333333', sub: 'BODY_SUB_SENTINEL', provider: 'BODY_PROVIDER_SENTINEL', accessToken: 'BODY_ACCESS_TOKEN_SENTINEL', refreshToken: 'BODY_REFRESH_TOKEN_SENTINEL', token: 'BODY_TOKEN_SENTINEL', userId: 'BODY_USER_ID_SENTINEL' };
    const { outcome } = await resolve(h, { body });
    assert.equal(outcome.status, 200); noSecrets(outcome.payload);
    const data = await h.storage.load(); assert.equal(data.users.length, 1); assert.equal(data.users[0].id, h.user.id); assert.equal(data.users[0].email, 'a@example.test'); assert.equal(data.users[0].authUserId, AUTH_ID); assert.equal(data.users.some(user => user.email === 'attacker@example.test'), false); assert.equal(JSON.stringify(outcome.payload).includes('BODY_'), false);
  } finally { await h.cleanup(); }
}

async function testPublicAuthenticationErrors() {
  const cases = [
    [{ sessionToken: undefined }, 'legacy_session_required', 401],
    [{ body: { password: 'wrong' } }, 'reauthentication_failed', 401],
    [{ authorization: undefined }, 'bearer_required', 401],
    [{ authorization: 'Basic abc' }, 'invalid_authorization', 401]
  ];
  for (const [options, error, status] of cases) {
    const h = await createHarness();
    try {
      const { outcome } = await resolve(h, options, { jwtVerifier: h.verifier });
      const messages = { legacy_session_required: '로그인이 필요합니다.', reauthentication_failed: '비밀번호를 확인해 주세요.', bearer_required: '인증을 확인할 수 없습니다.', invalid_authorization: '인증을 확인할 수 없습니다.' };
      assertOutcome(outcome, status, error, messages[error]); noSecrets(outcome.payload);
    } finally { await h.cleanup(); }
  }
  const h = await createHarness();
  try { const { outcome } = await resolve(h, {}, { jwtVerifier: async () => { throw new Error('RAW_JWT_INTERNAL_SENTINEL_5_2'); } }); assertOutcome(outcome, 401, 'invalid_token', '인증을 확인할 수 없습니다.'); noSecrets(outcome.payload); } finally { await h.cleanup(); }
}

async function testConflictResponse() {
  const h = await createHarness();
  try {
    const blocker = { ...h.user, id: 'blocker', email: 'blocker@example.test', authUserId: AUTH_ID };
    await h.storage.createUser(blocker);
    const { outcome } = await resolve(h);
    assertOutcome(outcome, 409, 'auth_link_conflict', '계정을 연결할 수 없습니다.'); assert.equal((await h.storage.findUserById(h.user.id)).authUserId, null); noSecrets(outcome.payload);
  } finally { await h.cleanup(); }
  const h2 = await createHarness();
  try {
    const current = await h2.storage.findUserById(h2.user.id); current.authUserId = '22222222-2222-4222-8222-222222222222';
    await h2.storage.linkUserToAuthUser(h2.user.id, current.authUserId);
    const { outcome } = await resolve(h2);
    assertOutcome(outcome, 409, 'auth_link_conflict', '계정을 연결할 수 없습니다.');
  } finally { await h2.cleanup(); }
}

async function testUnavailableResponse() {
  const h = await createHarness();
  try { const { outcome } = await resolve(h, {}, { jwtVerifier: null }); assertOutcome(outcome, 503, 'auth_link_unavailable', '인증 연결을 사용할 수 없습니다.'); } finally { await h.cleanup(); }
  const h2 = await createHarness();
  try { const { outcome } = await resolve(h2, {}, { storage: { ...h2.storage, linkUserToAuthUser: undefined } }); assertOutcome(outcome, 503, 'auth_link_unavailable', '인증 연결을 사용할 수 없습니다.'); } finally { await h2.cleanup(); }
}

async function testUnknownErrorRethrown() {
  const h = await createHarness();
  try {
    const error = new Error('RAW_DATABASE_SENTINEL_5_2'); error.code = 'UNEXPECTED_DATABASE_ERROR';
    await assert.rejects(() => resolve(h, {}, { storage: { ...h.storage, linkUserToAuthUser: async () => { throw error; } } }), caught => caught === error);
  } finally { await h.cleanup(); }
}

async function testSensitiveValuesNotExposed() {
  const h = await createHarness();
  try {
    const { outcome } = await resolve(h); noSecrets(outcome.payload);
    const { outcome: invalid } = await resolve(h, { body: { password: 'wrong' } }); noSecrets(invalid.payload);
  } finally { await h.cleanup(); }
}

async function run() {
  await testSuccessfulRouteResponse(); await testIdempotentRouteResponse(); await testOriginRequirements(); await testBodyValidation(); await testPublicAuthenticationErrors(); await testConflictResponse(); await testUnavailableResponse(); await testUnknownErrorRethrown(); await testSensitiveValuesNotExposed();
  console.log('user linking route tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
