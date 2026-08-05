'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJsonStorage } = require('./storage/json-storage');
const { hashPassword } = require('./auth/password');
const { linkSupabaseUser } = require('./auth/user-linking');
const { getLegacySessionUser } = require('./auth/request-auth');

const AUTH_ID_A = '11111111-1111-4111-8111-111111111111';
const AUTH_ID_B = '22222222-2222-4222-8222-222222222222';
const BODY_AUTH_ID = '33333333-3333-4333-8333-333333333333';

async function createHarness() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yyj-user-linking-'));
  const dataFile = path.join(directory, 'store.json');
  const storage = createJsonStorage(dataFile);
  return {
    directory,
    dataFile,
    storage,
    cleanup: async () => {
      await fs.rm(directory, { recursive: true, force: true });
      assert.equal(await fs.access(directory).then(() => true, () => false), false);
    }
  };
}

async function addUser(storage, { id, email, displayName, password, authUserId = null }) {
  const user = { id, email, displayName, ...hashPassword(password), authUserId, createdAt: new Date().toISOString() };
  await storage.createUser(user);
  return user;
}

async function addSession(storage, { userId, token, expiresAt = new Date(Date.now() + 60_000).toISOString() }) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await storage.createSession({ tokenHash, userId, createdAt: new Date().toISOString(), expiresAt });
  return token;
}

function createRequest(options) {
  const { sessionToken, body = {} } = options;
  const authorization = Object.prototype.hasOwnProperty.call(options, 'authorization') ? options.authorization : 'Bearer JWT_SECRET_SENTINEL_5_2';
  return { headers: { cookie: sessionToken ? `yyj_session=${encodeURIComponent(sessionToken)}` : undefined, authorization }, body };
}

function createVerifier(authUserId, extraClaims = {}) {
  return async token => {
    assert.equal(token, 'JWT_SECRET_SENTINEL_5_2');
    return { authUserId, ...extraClaims };
  };
}

async function expectCode(action, expectedCode) {
  try { await action(); assert.fail(`Expected ${expectedCode}`); } catch (error) {
    assert.equal(error.code, expectedCode);
    return error;
  }
}

async function addHarnessUser(harness, options) {
  const user = await addUser(harness.storage, options);
  const sessionToken = await addSession(harness.storage, { userId: user.id, token: `${user.id}-session` });
  return { user, password: options.password, sessionToken, request: authUserId => createRequest({ sessionToken }), verifier: authUserId => createVerifier(authUserId) };
}

async function testBasicLinkAndIdempotency() {
  const h = await createHarness();
  try {
    const a = await addHarnessUser(h, { id: 'user-a', email: 'a@example.test', displayName: 'A', password: 'password-a' });
    const first = await linkSupabaseUser({ req: a.request(AUTH_ID_A), storage: h.storage, jwtVerifier: a.verifier(AUTH_ID_A), password: a.password });
    assert.deepEqual(first, { item: { id: 'user-a', email: 'a@example.test', displayName: 'A', linked: true }, idempotent: false });
    assertNoSensitiveValues(first);
    const second = await linkSupabaseUser({ req: a.request(AUTH_ID_A), storage: h.storage, jwtVerifier: a.verifier(AUTH_ID_A), password: a.password });
    assert.equal(second.idempotent, true);
    const after = await h.storage.load();
    assert.equal(after.users.length, 1);
    assert.equal(after.users.filter(user => user.authUserId === AUTH_ID_A).length, 1);
    assert.equal((await h.storage.findUserByAuthUserId(AUTH_ID_A)).id, 'user-a');
  } finally { await h.cleanup(); }
}

async function testPasswordAndSessionBoundaries() {
  const h = await createHarness();
  try {
    const a = await addHarnessUser(h, { id: 'user-a', email: 'a@example.test', displayName: 'A', password: 'p'.repeat(128) });
    const run = (overrides = {}) => linkSupabaseUser({ req: a.request(AUTH_ID_A), storage: h.storage, jwtVerifier: a.verifier(AUTH_ID_A), password: a.password, ...overrides });
    assert.equal((await run()).item.id, 'user-a');
    let verifierCalls = 0;
    const validRequest = a.request(AUTH_ID_A);
    assert.equal((await linkSupabaseUser({ req: validRequest, storage: h.storage, password: a.password, jwtVerifier: async token => { verifierCalls += 1; return a.verifier(AUTH_ID_A)(token); } })).item.id, 'user-a');
    assert.equal(verifierCalls, 1);
    await expectCode(() => run({ password: undefined }), 'VALIDATION_ERROR');
    await expectCode(() => run({ password: '' }), 'VALIDATION_ERROR');
    await expectCode(() => run({ password: 123 }), 'VALIDATION_ERROR');
    await expectCode(() => run({ password: 'x'.repeat(129) }), 'VALIDATION_ERROR');
    await expectCode(() => run({ password: 'wrong' }), 'REAUTHENTICATION_FAILED');
    await expectCode(() => linkSupabaseUser({ req: createRequest({ sessionToken: undefined }), storage: h.storage, password: a.password, jwtVerifier: a.verifier(AUTH_ID_A) }), 'LEGACY_SESSION_REQUIRED');
    await expectCode(() => linkSupabaseUser({ req: createRequest({ sessionToken: 'missing-session' }), storage: h.storage, password: a.password, jwtVerifier: a.verifier(AUTH_ID_A) }), 'LEGACY_SESSION_REQUIRED');
    const expiredToken = await addSession(h.storage, { userId: a.user.id, token: 'expired-session', expiresAt: new Date(Date.now() - 1).toISOString() });
    await expectCode(() => linkSupabaseUser({ req: createRequest({ sessionToken: expiredToken }), storage: h.storage, password: a.password, jwtVerifier: a.verifier(AUTH_ID_A) }), 'LEGACY_SESSION_REQUIRED');
    assert.equal(await h.storage.findSessionByTokenHash(crypto.createHash('sha256').update(expiredToken).digest('hex')), null);
  } finally { await h.cleanup(); }
}

async function testAuthorizationBoundaries() {
  const h = await createHarness();
  try {
    const a = await addHarnessUser(h, { id: 'user-a', email: 'a@example.test', displayName: 'A', password: 'password-a' });
    const base = { storage: h.storage, password: a.password };
    await expectCode(() => linkSupabaseUser({ ...base, req: createRequest({ sessionToken: a.sessionToken, authorization: undefined }) }), 'BEARER_REQUIRED');
    await expectCode(() => linkSupabaseUser({ ...base, req: createRequest({ sessionToken: a.sessionToken, authorization: 'Basic abc' }) }), 'INVALID_AUTHORIZATION');
    await expectCode(() => linkSupabaseUser({ ...base, req: createRequest({ sessionToken: a.sessionToken, authorization: 'Bearer bad token' }) }), 'INVALID_AUTHORIZATION');
    await expectCode(() => linkSupabaseUser({ ...base, req: a.request(AUTH_ID_A), jwtVerifier: null }), 'JWT_AUTH_UNAVAILABLE');
    await expectCode(() => linkSupabaseUser({ ...base, req: a.request(AUTH_ID_A), jwtVerifier: async () => { throw new Error('RAW_JWT_INTERNAL_SENTINEL_5_2'); } }), 'INVALID_TOKEN');
    await expectCode(() => linkSupabaseUser({ ...base, req: a.request(AUTH_ID_A), jwtVerifier: async () => ({}) }), 'INVALID_TOKEN');
    await expectCode(() => linkSupabaseUser({ ...base, req: a.request(AUTH_ID_A), jwtVerifier: createVerifier('not-uuid') }), 'INVALID_TOKEN');
    await expectCode(() => linkSupabaseUser({ ...base, req: a.request(AUTH_ID_A), jwtVerifier: a.verifier(AUTH_ID_A), storage: { ...h.storage, linkUserToAuthUser: undefined } }), 'AUTH_CONFIGURATION_ERROR');
  } finally { await h.cleanup(); }
}

async function testSequentialCrossUserConflict() {
  const h = await createHarness();
  try {
    const a = await addHarnessUser(h, { id: 'user-a', email: 'a@example.test', displayName: 'A', password: 'password-a' });
    const b = await addHarnessUser(h, { id: 'user-b', email: 'b@example.test', displayName: 'B', password: 'password-b' });
    await linkSupabaseUser({ req: a.request(AUTH_ID_A), storage: h.storage, jwtVerifier: a.verifier(AUTH_ID_A), password: a.password });
    await expectCode(() => linkSupabaseUser({ req: b.request(AUTH_ID_A), storage: h.storage, jwtVerifier: b.verifier(AUTH_ID_A), password: b.password }), 'AUTH_LINK_CONFLICT');
    assert.equal((await h.storage.findUserByAuthUserId(AUTH_ID_A)).id, a.user.id);
    assert.equal((await h.storage.findUserById(b.user.id)).authUserId, null);
  } finally { await h.cleanup(); }
}

async function testConcurrentCrossUserConflict() {
  const h = await createHarness();
  try {
    const a = await addHarnessUser(h, { id: 'user-a', email: 'a@example.test', displayName: 'A', password: 'password-a' });
    const b = await addHarnessUser(h, { id: 'user-b', email: 'b@example.test', displayName: 'B', password: 'password-b' });
    const results = await Promise.allSettled([
      linkSupabaseUser({ req: a.request(AUTH_ID_A), storage: h.storage, jwtVerifier: a.verifier(AUTH_ID_A), password: a.password }),
      linkSupabaseUser({ req: b.request(AUTH_ID_A), storage: h.storage, jwtVerifier: b.verifier(AUTH_ID_A), password: b.password })
    ]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter(item => item.status === 'rejected' && item.reason.code === 'AUTH_LINK_CONFLICT').length, 1);
    const winnerId = results.find(item => item.status === 'fulfilled').value.item.id;
    const loserId = winnerId === a.user.id ? b.user.id : a.user.id;
    assert.equal((await h.storage.findUserByAuthUserId(AUTH_ID_A)).id, winnerId);
    assert.equal((await h.storage.findUserById(loserId)).authUserId, null);
    const after = await h.storage.load();
    assert.equal(after.users.length, 2);
    assert.equal(after.users.filter(user => user.authUserId === AUTH_ID_A).length, 1);
    const reloaded = createJsonStorage(h.dataFile);
    const reloadedData = await reloaded.load();
    assert.equal(reloadedData.users.length, 2);
    assert.equal(reloadedData.users.filter(user => user.authUserId === AUTH_ID_A).length, 1);
    assert.equal((await reloaded.findUserByAuthUserId(AUTH_ID_A)).id, winnerId);
    assert.equal(reloadedData.users.find(user => user.id === loserId).authUserId, null);
  } finally { await h.cleanup(); }
}

async function testConcurrentSameUserIdempotency() {
  const h = await createHarness();
  try {
    const a = await addHarnessUser(h, { id: 'user-a', email: 'a@example.test', displayName: 'A', password: 'password-a' });
    const results = await Promise.allSettled([1, 2].map(() => linkSupabaseUser({ req: a.request(AUTH_ID_A), storage: h.storage, jwtVerifier: a.verifier(AUTH_ID_A), password: a.password })));
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 2);
    assert.equal(results.filter(item => item.status === 'rejected').length, 0);
    assert.equal((await h.storage.findUserByAuthUserId(AUTH_ID_A)).id, a.user.id);
    const data = await h.storage.load();
    assert.equal(data.users.length, 1);
    assert.equal(data.users.filter(user => user.authUserId === AUTH_ID_A).length, 1);
    const reloaded = createJsonStorage(h.dataFile);
    const reloadedData = await reloaded.load();
    assert.equal(reloadedData.users.length, 1);
    assert.equal(reloadedData.users[0].authUserId, AUTH_ID_A);
    assert.equal(reloadedData.users.filter(user => user.authUserId === AUTH_ID_A).length, 1);
  } finally { await h.cleanup(); }
}

async function testBodyAndEmailAreIgnored() {
  const h = await createHarness();
  try {
    const a = await addHarnessUser(h, { id: 'user-a', email: 'a@example.test', displayName: 'A', password: 'password-a' });
    let emailCalls = 0; let createCalls = 0;
    const storage = new Proxy(h.storage, { get(target, property, receiver) {
      if (property === 'findUserByEmail') return async () => { emailCalls += 1; throw new Error('email lookup'); };
      if (property === 'createUser') return async () => { createCalls += 1; throw new Error('create user'); };
      return Reflect.get(target, property, receiver);
    } });
    const result = await linkSupabaseUser({ storage, password: a.password, req: createRequest({ sessionToken: a.sessionToken, body: { email: 'attacker@example.test', authUserId: BODY_AUTH_ID, sub: BODY_AUTH_ID, provider: 'attacker', accessToken: 'BODY_ACCESS_TOKEN_SENTINEL', refreshToken: 'BODY_REFRESH_TOKEN_SENTINEL', token: 'BODY_TOKEN_SENTINEL' } }), jwtVerifier: a.verifier(AUTH_ID_A) });
    assert.equal(result.item.id, a.user.id);
    assert.equal(emailCalls, 0); assert.equal(createCalls, 0);
    const users = await h.storage.load();
    assert.equal(users.users.length, 1);
    assert.equal(users.users[0].email, 'a@example.test');
    assert.equal(users.users[0].authUserId, AUTH_ID_A);
    assert.equal(users.users.some(user => user.email === 'attacker@example.test'), false);
    assert.equal(users.users.some(user => user.authUserId === BODY_AUTH_ID), false);
    assert.equal((await h.storage.findUserByAuthUserId(BODY_AUTH_ID)), null);
  } finally { await h.cleanup(); }
}

async function testFailurePreservesExistingDataAndSession() {
  const h = await createHarness();
  try {
    const owner = await addHarnessUser(h, { id: 'owner', email: 'owner@example.test', displayName: 'Owner', password: 'owner-password' });
    const blocker = await addHarnessUser(h, { id: 'blocker', email: 'blocker@example.test', displayName: 'Blocker', password: 'blocker-password', authUserId: AUTH_ID_A });
    const collection = { id: 'collection-1', ownerId: owner.user.id, name: 'Saved', privacy: 'private', shareToken: null, createdAt: new Date().toISOString() };
    const place = { id: 'place-1', ownerId: owner.user.id, name: 'Place', category: 'food', memo: '', tags: [], visitedAt: '2026-01-01', latitude: 1, longitude: 2, collectionId: null, privacy: 'private', imageUrl: null, createdAt: new Date().toISOString() };
    await h.storage.createCollection(collection); await h.storage.createPlace(place);
    const before = await h.storage.load();
    await expectCode(() => linkSupabaseUser({ req: owner.request(AUTH_ID_A), storage: h.storage, jwtVerifier: owner.verifier(AUTH_ID_A), password: owner.password }), 'AUTH_LINK_CONFLICT');
    assert.deepEqual(await h.storage.load(), before);
    assert.equal((await getLegacySessionUser({ req: owner.request(AUTH_ID_A), storage: h.storage })).user.id, owner.user.id);
    assert.equal((await h.storage.findUserById(blocker.user.id)).authUserId, AUTH_ID_A);
  } finally { await h.cleanup(); }
}

function assertNoSensitiveValues(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of ['PASSWORD_SECRET_SENTINEL_5_2', 'JWT_SECRET_SENTINEL_5_2', 'SESSION_SECRET_SENTINEL_5_2', 'RAW_JWT_INTERNAL_SENTINEL_5_2', 'CLAIM_SECRET_SENTINEL_5_2', 'passwordHash', 'passwordSalt', 'authUserId', 'accessToken', 'refreshToken', 'providerToken']) assert.equal(serialized.includes(secret), false, secret);
}

async function testSensitiveValuesNotExposed() {
  const h = await createHarness();
  try {
    const a = await addHarnessUser(h, { id: 'user-a', email: 'a@example.test', displayName: 'A', password: 'PASSWORD_SECRET_SENTINEL_5_2' });
    a.sessionToken = await addSession(h.storage, { userId: a.user.id, token: 'SESSION_SECRET_SENTINEL_5_2' });
    const result = await linkSupabaseUser({ req: createRequest({ sessionToken: a.sessionToken }), storage: h.storage, password: a.password, jwtVerifier: async token => { assert.equal(token, 'JWT_SECRET_SENTINEL_5_2'); return { authUserId: AUTH_ID_A, internalClaim: 'CLAIM_SECRET_SENTINEL_5_2' }; } });
    assertNoSensitiveValues(result);
    const assertSafeError = async action => {
      const error = await action().catch(value => value);
      assertNoSensitiveValues(error.message); assertNoSensitiveValues(String(error)); assertNoSensitiveValues(error);
      return error;
    };
    await assertSafeError(() => linkSupabaseUser({ req: a.request(AUTH_ID_A), storage: h.storage, password: undefined, jwtVerifier: a.verifier(AUTH_ID_A) }));
    await assertSafeError(() => linkSupabaseUser({ req: a.request(AUTH_ID_A), storage: h.storage, password: 'wrong', jwtVerifier: a.verifier(AUTH_ID_A) }));
    await assertSafeError(() => linkSupabaseUser({ req: createRequest({ sessionToken: a.sessionToken, authorization: 'Basic abc' }), storage: h.storage, password: a.password, jwtVerifier: a.verifier(AUTH_ID_A) }));
    await assertSafeError(() => linkSupabaseUser({ req: a.request(AUTH_ID_A), storage: h.storage, password: a.password, jwtVerifier: async () => { throw new Error('RAW_JWT_INTERNAL_SENTINEL_5_2'); } }));
    const blocker = await addHarnessUser(h, { id: 'blocker', email: 'blocker@example.test', displayName: 'Blocker', password: 'blocker-password', });
    await linkSupabaseUser({ req: blocker.request(AUTH_ID_B), storage: h.storage, password: blocker.password, jwtVerifier: blocker.verifier(AUTH_ID_B) });
    const conflict = await assertSafeError(() => linkSupabaseUser({ req: a.request(AUTH_ID_B), storage: h.storage, password: a.password, jwtVerifier: a.verifier(AUTH_ID_B) }));
    assert.equal(conflict.code, 'AUTH_LINK_CONFLICT');
  } finally { await h.cleanup(); }
}

async function testReturnedUserIsClone() {
  const h = await createHarness();
  try {
    const a = await addHarnessUser(h, { id: 'user-a', email: 'a@example.test', displayName: 'A', password: 'password-a' });
    await linkSupabaseUser({ req: a.request(AUTH_ID_A), storage: h.storage, jwtVerifier: a.verifier(AUTH_ID_A), password: a.password });
    const returned = await h.storage.findUserByAuthUserId(AUTH_ID_A);
    returned.email = 'changed@example.test'; returned.displayName = 'Changed'; returned.authUserId = AUTH_ID_B; returned.passwordHash = 'changed'; returned.passwordSalt = 'changed';
    const original = await h.storage.findUserById(a.user.id);
    assert.equal(original.email, 'a@example.test'); assert.equal(original.displayName, 'A'); assert.equal(original.authUserId, AUTH_ID_A); assert.notEqual(original.passwordHash, 'changed'); assert.notEqual(original.passwordSalt, 'changed');
  } finally { await h.cleanup(); }
}

async function testCreateUserUniquenessAndPersistence() {
  const h2 = await createHarness();
  try {
    await addUser(h2.storage, { id: 'user-a', email: 'a@example.test', displayName: 'A', password: 'password-a', authUserId: AUTH_ID_A });
    await expectCode(() => addUser(h2.storage, { id: 'user-b', email: 'b@example.test', displayName: 'B', password: 'password-b', authUserId: AUTH_ID_A }), 'AUTH_USER_EXISTS');
    await expectCode(() => addUser(h2.storage, { id: 'user-c', email: 'a@example.test', displayName: 'C', password: 'password-c' }), 'EMAIL_EXISTS');
    const c = await addUser(h2.storage, { id: 'user-d', email: 'd@example.test', displayName: 'D', password: 'password-d' });
    assert.equal(c.authUserId, null);
    const reloaded = createJsonStorage(h2.dataFile);
    assert.equal((await reloaded.findUserByAuthUserId(AUTH_ID_A)).email, 'a@example.test');
  } finally { await h2.cleanup(); }
}

async function run() {
  await testBasicLinkAndIdempotency();
  await testPasswordAndSessionBoundaries();
  await testAuthorizationBoundaries();
  await testSequentialCrossUserConflict();
  await testConcurrentCrossUserConflict();
  await testConcurrentSameUserIdempotency();
  await testBodyAndEmailAreIgnored();
  await testFailurePreservesExistingDataAndSession();
  await testSensitiveValuesNotExposed();
  await testReturnedUserIsClone();
  await testCreateUserUniquenessAndPersistence();
  console.log('user linking tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
