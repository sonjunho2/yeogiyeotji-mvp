'use strict';

const assert = require('node:assert/strict');
const { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } = require('jose');
const { resolveSupabaseJwtConfig, createSupabaseJwtVerifier } = require('./auth/supabase-jwt');

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
async function assertInvalidToken(verifier, token, hiddenValues = []) {
  await assert.rejects(() => verifier(token), error => {
    assert.equal(error.code, 'INVALID_SUPABASE_JWT');
    assert.equal(error.message, 'Invalid Supabase JWT');
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.doesNotMatch(error.message, new RegExp(escapeRegExp(token)));
    for (const value of hiddenValues) assert.equal(error.message.includes(value), false);
    return true;
  });
}

(async () => {
  assert.deepEqual(resolveSupabaseJwtConfig({}), { enabled: false });
  for (const env of [{ SUPABASE_JWT_ISSUER: 'https://x/auth/v1' }, { SUPABASE_JWKS_URL: 'https://x/auth/v1/.well-known/jwks.json' }, { SUPABASE_JWT_AUDIENCE: 'x' }]) assert.throws(() => resolveSupabaseJwtConfig(env), error => error.code === 'SUPABASE_JWT_CONFIG_ERROR');
  assert.throws(() => resolveSupabaseJwtConfig({ SUPABASE_URL: 'http://example.supabase.co' }), error => error.code === 'SUPABASE_JWT_CONFIG_ERROR');
  assert.equal(resolveSupabaseJwtConfig({ SUPABASE_URL: 'http://example.supabase.co' }, { allowInsecureHttp: true }).enabled, true);
  for (const value of ['https://example.supabase.co/path', 'https://user@example.supabase.co', 'https://user:pass@example.supabase.co', 'https://example.supabase.co/auth/v1?x=1', 'https://example.supabase.co/auth/v1#x']) assert.throws(() => resolveSupabaseJwtConfig({ SUPABASE_URL: value }), error => error.code === 'SUPABASE_JWT_CONFIG_ERROR' && !error.message.includes(value));
  assert.throws(() => resolveSupabaseJwtConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_JWT_ISSUER: 'https://other.supabase.co/auth/v1' }), error => error.code === 'SUPABASE_JWT_CONFIG_ERROR');
  assert.throws(() => resolveSupabaseJwtConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_JWKS_URL: 'https://other.supabase.co/auth/v1/.well-known/jwks.json' }), error => error.code === 'SUPABASE_JWT_CONFIG_ERROR');
  assert.throws(() => resolveSupabaseJwtConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_JWT_AUDIENCE: ' ' }), error => error.code === 'SUPABASE_JWT_CONFIG_ERROR');
  const config = resolveSupabaseJwtConfig({ SUPABASE_URL: 'https://example.supabase.co' });
  assert.equal(config.issuer, 'https://example.supabase.co/auth/v1');
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = await exportJWK(publicKey); jwk.kid = 'test-kid';
  const verifier = await createSupabaseJwtVerifier({ config, jwks: createLocalJWKSet({ keys: [jwk] }) });
  const sub = '11111111-1111-4111-8111-111111111111';
  const token = await new SignJWT({ role: 'authenticated', session_id: 'session' }).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' }).setIssuer(config.issuer).setAudience('authenticated').setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  assert.deepEqual(await verifier(token), { authUserId: sub, role: 'authenticated', sessionId: 'session' });
  assert.deepEqual(Object.keys(await verifier(token)).sort(), ['authUserId', 'role', 'sessionId']);
  const { privateKey: rsaPrivateKey, publicKey: rsaPublicKey } = await generateKeyPair('RS256');
  const rsaJwk = await exportJWK(rsaPublicKey); rsaJwk.kid = 'rsa-kid';
  const rsaVerifier = await createSupabaseJwtVerifier({ config, jwks: createLocalJWKSet({ keys: [rsaJwk] }) });
  const rsaToken = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'rsa-kid' }).setIssuer(config.issuer).setAudience(config.audience).setSubject(sub).setExpirationTime('5m').sign(rsaPrivateKey);
  assert.equal((await rsaVerifier(rsaToken)).authUserId, sub);
  const { privateKey: otherPrivateKey } = await generateKeyPair('ES256');
  const wrongSignature = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' }).setIssuer(config.issuer).setAudience(config.audience).setSubject(sub).setExpirationTime('5m').sign(otherPrivateKey);
  await assertInvalidToken(verifier, wrongSignature);
  const unknownKid = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'unknown-kid' }).setIssuer(config.issuer).setAudience(config.audience).setSubject(sub).setExpirationTime('5m').sign(privateKey);
  await assertInvalidToken(verifier, unknownKid, ['unknown-kid']);
  const hs256 = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: 'test-kid' }).setIssuer(config.issuer).setAudience(config.audience).setSubject(sub).setExpirationTime('5m').sign(Buffer.from('test-secret'));
  await assertInvalidToken(verifier, hs256);
  await assertInvalidToken(verifier, 'not-a-jwt');
  for (const claims of [{ role: 'anon' }, { role: 'service_role' }, { role: 'authenticated', is_anonymous: true }, { role: 'authenticated', sub: 'not-uuid' }, { role: undefined }]) {
    const builder = new SignJWT(claims).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' }).setIssuer(config.issuer).setAudience(config.audience).setExpirationTime('5m');
    if (!Object.prototype.hasOwnProperty.call(claims, 'sub')) builder.setSubject(sub);
    const invalidToken = await builder.sign(privateKey);
    await assertInvalidToken(verifier, invalidToken, ['https://example.supabase.co/auth/v1', 'test-kid']);
  }
  const missingSub = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' }).setIssuer(config.issuer).setAudience(config.audience).setExpirationTime('5m').sign(privateKey);
  await assertInvalidToken(verifier, missingSub);
  const numericSub = await new SignJWT({ role: 'authenticated', sub: 12345 }).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' }).setIssuer(config.issuer).setAudience(config.audience).setExpirationTime('5m').sign(privateKey);
  await assertInvalidToken(verifier, numericSub);
  const noKid = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', typ: 'JWT' }).setIssuer(config.issuer).setAudience(config.audience).setSubject(sub).setExpirationTime('5m').sign(privateKey);
  await assert.rejects(() => verifier(noKid), error => error.code === 'INVALID_SUPABASE_JWT');
  for (const header of [{ alg: 'ES256', kid: 'test-kid' }, { alg: 'ES256', typ: 'JWT', kid: ' ' }, { alg: 'ES256', typ: 'NOT-JWT', kid: 'test-kid' }]) {
    const invalidHeader = await new SignJWT({ role: 'authenticated' }).setProtectedHeader(header).setIssuer(config.issuer).setAudience(config.audience).setSubject(sub).setExpirationTime('5m').sign(privateKey);
    await assertInvalidToken(verifier, invalidHeader);
  }
  for (const claim of [{ issuer: 'https://wrong.example/auth/v1' }, { audience: 'wrong' }]) {
    const invalidClaim = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' }).setIssuer(claim.issuer || config.issuer).setAudience(claim.audience || config.audience).setSubject(sub).setExpirationTime('5m').sign(privateKey);
    await assertInvalidToken(verifier, invalidClaim, [claim.issuer || 'wrong', claim.audience || 'wrong']);
  }
  const expired = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' }).setIssuer(config.issuer).setAudience(config.audience).setSubject(sub).setExpirationTime('-10s').sign(privateKey);
  await assertInvalidToken(verifier, expired);
  const futureNbf = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' }).setIssuer(config.issuer).setAudience(config.audience).setSubject(sub).setExpirationTime('5m').setNotBefore('1h').sign(privateKey);
  await assertInvalidToken(verifier, futureNbf);
  const noExp = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' }).setIssuer(config.issuer).setAudience(config.audience).setSubject(sub).sign(privateKey);
  await assertInvalidToken(verifier, noExp);
  const badRole = await new SignJWT({ role: 'anon' }).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' }).setIssuer(config.issuer).setAudience('authenticated').setSubject(sub).setExpirationTime('5m').sign(privateKey);
  await assert.rejects(() => verifier(badRole));
  let factoryCalls = 0; let factoryOptions; let factoryUrl;
  const factoryVerifier = await createSupabaseJwtVerifier({ config, createRemoteJWKSetFn: (url, options) => { factoryCalls += 1; factoryUrl = url.toString(); factoryOptions = options; return createLocalJWKSet({ keys: [jwk] }); } });
  await factoryVerifier(token); await factoryVerifier(token);
  assert.equal(factoryCalls, 1); assert.equal(factoryUrl, config.jwksUrl); assert.equal(factoryOptions.cacheMaxAge, 600000); assert.equal(factoryOptions.cooldownDuration, 30000); assert.equal(factoryOptions.timeoutDuration, 5000);
  console.log('Supabase JWT tests passed: config, ES256 verification, claims, and rejection');
})().catch(error => { console.error(`Supabase JWT tests failed: ${error.message}`); process.exitCode = 1; });
