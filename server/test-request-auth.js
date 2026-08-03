'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseAuthorizationHeader, resolveRequestAuthentication } = require('./auth/request-auth');

const userA = { id: 'a', authUserId: 'auth-a', passwordHash: 'hash', passwordSalt: 'salt' };
const userB = { id: 'b', authUserId: 'auth-b', passwordHash: 'hash', passwordSalt: 'salt' };
const token = 'legacy-token-a';
const hash = crypto.createHash('sha256').update(token).digest('hex');

function makeStorage(options = {}) {
  const calls = { findSessionByTokenHash: 0, deleteSession: 0, findUserById: 0, findUserByAuthUserId: 0 };
  const storage = {
    calls,
    findSessionByTokenHash: async value => { calls.findSessionByTokenHash += 1; if (options.findSessionByTokenHash) return options.findSessionByTokenHash(value); return value === hash ? { userId: 'a', expiresAt: options.expired ? '2000-01-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z' } : null; },
    deleteSession: async value => { calls.deleteSession += 1; if (options.deleteSession) return options.deleteSession(value); return true; },
    findUserById: async id => { calls.findUserById += 1; if (options.findUserById) return options.findUserById(id); return id === 'a' ? userA : null; },
    findUserByAuthUserId: async id => { calls.findUserByAuthUserId += 1; if (options.findUserByAuthUserId) return options.findUserByAuthUserId(id); return id === 'auth-a' ? userA : id === 'auth-b' ? userB : null; }
  };
  if (options.noAuthLookup) delete storage.findUserByAuthUserId;
  return storage;
}

function request(authorization, cookie) {
  if (arguments.length < 2) cookie = token;
  const headers = {};
  if (authorization !== undefined) headers.authorization = authorization;
  if (cookie !== undefined) headers.cookie = `yyj_session=${cookie}`;
  return { headers };
}

function assertAuthError(error, code) { assert.equal(error.code, code); }

(async () => {
  assert.equal(parseAuthorizationHeader(undefined), null);
  for (const value of ['', 'Basic x', 'Bearer', 'Bearer one two', 'Bearer  one', 'Bearer one,two', ['Bearer x'], 12, `Bearer ${'x'.repeat(16384)}`]) assert.throws(() => parseAuthorizationHeader(value), error => error.code === 'INVALID_AUTHORIZATION');
  for (const value of ['', 'Basic x', 'Bearer', 'Bearer one two', 'Bearer  one', 'Bearer one,two', ['Bearer x'], 12, `Bearer ${'x'.repeat(16384)}`]) {
    const isolated = makeStorage();
    await assert.rejects(() => resolveRequestAuthentication({ req: request(value), storage: isolated, jwtVerifier: async () => ({ authUserId: 'auth-a' }) }), error => error.code === 'INVALID_AUTHORIZATION');
    assert.equal(isolated.calls.findSessionByTokenHash, 0);
  }

  let storage = makeStorage();
  const legacy = await resolveRequestAuthentication({ req: request(), storage, jwtVerifier: null });
  assert.equal(legacy.method, 'yyj_session');
  assert.equal(Object.hasOwn(legacy, 'legacySessionToken'), false);
  assert.equal(await resolveRequestAuthentication({ req: request(undefined, undefined), storage, jwtVerifier: null }), null);
  assert.equal(await resolveRequestAuthentication({ req: request(undefined, 'other') , storage, jwtVerifier: null }), null);
  storage = makeStorage({ expired: true });
  assert.equal(await resolveRequestAuthentication({ req: request(), storage, jwtVerifier: null }), null);
  assert.equal(storage.calls.deleteSession, 1);
  storage = makeStorage();
  assert.equal(await resolveRequestAuthentication({ req: request(undefined, '%E0%A4%A'), storage, jwtVerifier: null }), null);
  for (const userOptions of [{ findUserById: async () => null }, { findUserById: async () => ({ ...userA, passwordHash: undefined }) }, { findUserById: async () => ({ ...userA, passwordSalt: undefined }) }]) {
    storage = makeStorage(userOptions);
    assert.equal(await resolveRequestAuthentication({ req: request(), storage, jwtVerifier: null }), null);
    assert.equal(storage.calls.deleteSession, 1);
  }

  const verifier = async () => ({ authUserId: 'auth-a', role: 'authenticated', sessionId: null });
  assert.equal((await resolveRequestAuthentication({ req: request('Bearer valid', undefined), storage: makeStorage(), jwtVerifier: verifier })).method, 'supabase_jwt');
  assert.equal((await resolveRequestAuthentication({ req: request('Bearer valid'), storage: makeStorage({ findUserByAuthUserId: async () => ({ id: 'a', authUserId: 'auth-a' }) }), jwtVerifier: verifier })).user.passwordHash, undefined);
  assert.equal((await resolveRequestAuthentication({ req: request('Bearer valid'), storage: makeStorage(), jwtVerifier: verifier })).method, 'supabase_jwt');
  storage = makeStorage({ findSessionByTokenHash: async () => ({ userId: 'a', expiresAt: '2000-01-01T00:00:00.000Z' }) });
  assert.equal((await resolveRequestAuthentication({ req: request('Bearer valid'), storage, jwtVerifier: verifier })).method, 'supabase_jwt');
  assert.equal(storage.calls.deleteSession, 1);
  storage = makeStorage({ findSessionByTokenHash: async () => null });
  assert.equal((await resolveRequestAuthentication({ req: request('Bearer valid'), storage, jwtVerifier: verifier })).method, 'supabase_jwt');
  await assert.rejects(() => resolveRequestAuthentication({ req: request('Bearer valid'), storage: makeStorage(), jwtVerifier: async () => { throw new Error('raw'); } }), error => error.code === 'INVALID_TOKEN', 'verifier failure');
  storage = makeStorage();
  await assert.rejects(() => resolveRequestAuthentication({ req: request('Bearer valid'), storage, jwtVerifier: async () => { throw new Error('raw'); } }), error => error.code === 'INVALID_TOKEN', 'verifier failure no session lookup');
  assert.equal(storage.calls.findSessionByTokenHash, 0);
  await assert.rejects(() => resolveRequestAuthentication({ req: request('Bearer valid'), storage: makeStorage(), jwtVerifier: null }), error => error.code === 'JWT_AUTH_UNAVAILABLE', 'verifier unavailable');
  await assert.rejects(() => resolveRequestAuthentication({ req: request('Bearer valid'), storage: makeStorage({ findUserByAuthUserId: async () => null }), jwtVerifier: verifier }), error => error.code === 'AUTH_USER_NOT_LINKED', 'not linked');
  await assert.rejects(() => resolveRequestAuthentication({ req: request('Bearer valid'), storage: makeStorage({ noAuthLookup: true }), jwtVerifier: verifier }), error => error.code === 'AUTH_CONFIGURATION_ERROR', 'missing lookup');
  await assert.rejects(() => resolveRequestAuthentication({ req: request('Bearer valid'), storage: makeStorage({ findUserByAuthUserId: async () => userB }), jwtVerifier: verifier }), error => error.code === 'AUTH_IDENTITY_CONFLICT', 'identity conflict');

  for (const [name, method] of [['findUserByAuthUserId', 'findUserByAuthUserId'], ['findSessionByTokenHash', 'findSessionByTokenHash'], ['findUserById', 'findUserById'], ['deleteSession', 'deleteSession']]) {
    const raw = new Error(name);
    const failing = makeStorage({ [method]: async () => { throw raw; }, expired: method === 'deleteSession' });
    const operation = name === 'findUserByAuthUserId' ? resolveRequestAuthentication({ req: request('Bearer valid'), storage: failing, jwtVerifier: verifier }) : resolveRequestAuthentication({ req: request(), storage: failing, jwtVerifier: null });
    await assert.rejects(operation, error => { assert.strictEqual(error, raw, name); return true; }, `storage error: ${name}`);
  }
  console.log('Request auth tests passed: isolated authorization, legacy session, JWT priority, and storage error propagation scenarios');
})().catch(error => { console.error(`Request auth tests failed: ${error.message}`); process.exitCode = 1; });
