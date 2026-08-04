'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = 4199;
const realDataFile = path.join(__dirname, 'data', 'store.json');
const realDataBefore = fs.readFileSync(realDataFile);
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeogiyeotji-test-'));
const dataFile = path.join(temporaryDirectory, 'store.json');
const childEnv = { ...process.env, PORT: String(port), DATA_FILE: dataFile, NODE_ENV: 'test' };
delete childEnv.SUPABASE_URL;
delete childEnv.SUPABASE_EMAIL_OTP_ENABLED;
delete childEnv.SUPABASE_PUBLISHABLE_KEY;
delete childEnv.SUPABASE_JWT_ISSUER;
delete childEnv.SUPABASE_JWKS_URL;
delete childEnv.SUPABASE_JWT_AUDIENCE;
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe']
});

const baseUrl = `http://127.0.0.1:${port}`;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (_) {}
    await wait(100);
  }
  throw new Error('테스트 서버가 시작되지 않았습니다.');
}

function createClient() {
  let cookie = '';
  return async (route, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.cookie = cookie;
    const response = await fetch(`${baseUrl}${route}`, { ...options, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    return { response, body };
  };
}

const jsonOptions = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const assertNoSecrets = body => assert.doesNotMatch(JSON.stringify(body), /authUserId|jwt|claims|passwordHash|passwordSalt|sessionId|sessionToken|tokenHash|legacySessionToken/i);

(async () => {
  const anonymous = createClient();
  const userA = createClient();
  const userB = createClient();
  try {
    await waitForServer();

    const authConfig = await fetch(`${baseUrl}/api/auth/config`);
    assert.equal(authConfig.status, 200);
    assert.equal(authConfig.headers.get('cache-control'), 'no-store');
    const authConfigBody = await authConfig.json();
    assert.deepEqual(authConfigBody, { item: { enabled: false, emailOtpEnabled: false } });
    assert.doesNotMatch(JSON.stringify(authConfigBody), /secret|serviceRole|service_role|processEnv|process\.env/i);
    const postConfig = await fetch(`${baseUrl}/api/auth/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.notEqual(postConfig.status, 200);

    const proxyRegister = await fetch(`${baseUrl}/api/auth/register`, {
      ...jsonOptions('POST', { email: 'proxy@example.com', password: 'proxy-password', displayName: 'Proxy user' }),
      headers: { 'content-type': 'application/json', origin: `https://127.0.0.1:${port}`, 'x-forwarded-proto': 'https' }
    });
    const proxyRegisterBody = await proxyRegister.json();
    assert.equal(proxyRegister.status, 201);
    assert.match(proxyRegister.headers.get('set-cookie'), /Secure/);
    assertNoSecrets(proxyRegisterBody);

    const blockedProxy = await fetch(`${baseUrl}/api/auth/register`, {
      ...jsonOptions('POST', { email: 'blocked-proxy@example.com', password: 'proxy-password', displayName: 'Blocked proxy' }),
      headers: { 'content-type': 'application/json', origin: 'https://example.com', 'x-forwarded-proto': 'https' }
    });
    const blockedProxyBody = await blockedProxy.json();
    assert.equal(blockedProxy.status, 403);
    assert.equal(blockedProxyBody.error, 'invalid_origin');

    const registerA = await userA('/api/auth/register', jsonOptions('POST', { email: ' A@Example.com ', password: 'password-A', displayName: ' 사용자 A ' }));
    assert.equal(registerA.response.status, 201);
    assert.deepEqual(registerA.body.item.email, 'a@example.com');
    assert.equal(registerA.body.item.displayName, '사용자 A');
    assert.match(registerA.response.headers.get('set-cookie'), /yyj_session=.*HttpOnly.*SameSite=Lax.*Path=\//);
    assertNoSecrets(registerA.body);

    const duplicate = await anonymous('/api/auth/register', jsonOptions('POST', { email: 'a@example.com', password: 'password-X', displayName: '중복' }));
    assert.equal(duplicate.response.status, 409);
    const badEmail = await anonymous('/api/auth/register', jsonOptions('POST', { email: 'wrong', password: 'password-X', displayName: '오류' }));
    assert.equal(badEmail.response.status, 400);
    const shortPassword = await anonymous('/api/auth/register', jsonOptions('POST', { email: 'short@example.com', password: '1234567', displayName: '오류' }));
    assert.equal(shortPassword.response.status, 400);

    const loginClient = createClient();
    const login = await loginClient('/api/auth/login', jsonOptions('POST', { email: 'a@example.com', password: 'password-A' }));
    assert.equal(login.response.status, 200);
    assertNoSecrets(login.body);
    const wrongPassword = await anonymous('/api/auth/login', jsonOptions('POST', { email: 'a@example.com', password: 'not-the-password' }));
    assert.equal(wrongPassword.response.status, 401);
    assert.equal(wrongPassword.body.message, '이메일 또는 비밀번호가 올바르지 않습니다.');

    const me = await loginClient('/api/auth/me');
    assert.equal(me.response.status, 200);
    assertNoSecrets(me.body);
    const cookieOnly = await loginClient('/api/places');
    assert.equal(cookieOnly.response.status, 200);
    const malformedBearer = await loginClient('/api/places', { headers: { authorization: 'Bearer malformed-token' } });
    assert.equal(malformedBearer.response.status, 401);
    assert.equal(malformedBearer.body.error, 'jwt_auth_unavailable');
    const basicAuth = await loginClient('/api/places', { headers: { authorization: 'Basic abc' } });
    assert.equal(basicAuth.response.status, 401);
    assert.equal(basicAuth.body.error, 'invalid_authorization');
    assert.equal((await loginClient('/api/places')).response.status, 200);
    const logout = await loginClient('/api/auth/logout', jsonOptions('POST', {}));
    assert.equal(logout.response.status, 200);
    assert.equal(logout.body.ok, true);
    assert.equal((await loginClient('/api/auth/me')).response.status, 401);
    assert.equal((await anonymous('/api/places')).response.status, 401);

    const anonymousCollection = await anonymous('/api/collections', jsonOptions('POST', { name: '미인증', privacy: 'private' }));
    assert.equal(anonymousCollection.response.status, 401);
    const blankCollection = await userA('/api/collections', jsonOptions('POST', { name: '   ', privacy: 'private' }));
    assert.equal(blankCollection.response.status, 400);
    const longCollection = await userA('/api/collections', jsonOptions('POST', { name: '가'.repeat(61), privacy: 'private' }));
    assert.equal(longCollection.response.status, 400);
    const invalidPrivacy = await userA('/api/collections', jsonOptions('POST', { name: '공개 범위 오류', privacy: 'public' }));
    assert.equal(invalidPrivacy.response.status, 400);

    const collectionA = await userA('/api/collections', jsonOptions('POST', { name: ' A 컬렉션 ', privacy: 'private', ownerId: 'forged-owner' }));
    assert.equal(collectionA.response.status, 201);
    assert.equal(collectionA.body.item.name, 'A 컬렉션');
    assert.equal(collectionA.body.item.privacy, 'private');
    assert.equal(collectionA.body.item.ownerId, registerA.body.item.id);
    assert.notEqual(collectionA.body.item.ownerId, 'forged-owner');
    const placeA = await userA('/api/places', jsonOptions('POST', { name: 'A 장소', category: '카페', latitude: 37.5, longitude: 127, collectionId: collectionA.body.item.id }));
    assert.equal(placeA.response.status, 201);
    assert.equal(placeA.body.item.ownerId, registerA.body.item.id);
    const listA = await userA('/api/places');
    assert.equal(listA.body.items.length, 1);
    assert.equal(listA.body.items[0].id, placeA.body.item.id);

    const registerB = await userB('/api/auth/register', jsonOptions('POST', { email: 'b@example.com', password: 'password-B', displayName: '사용자 B' }));
    assert.equal(registerB.response.status, 201);
    assert.equal((await userB(`/api/places/${placeA.body.item.id}`)).response.status, 404);
    assert.equal((await userB(`/api/places/${placeA.body.item.id}`, { method: 'DELETE' })).response.status, 404);
    assert.equal((await userA(`/api/places/${placeA.body.item.id}`)).response.status, 200);

    const collectionB = await userB('/api/collections', jsonOptions('POST', { name: 'B 컬렉션', privacy: 'private' }));
    assert.equal(collectionB.response.status, 201);
    assert.deepEqual((await userA('/api/collections')).body.items.map(item => item.id), [collectionA.body.item.id]);
    assert.deepEqual((await userB('/api/collections')).body.items.map(item => item.id), [collectionB.body.item.id]);
    const crossCollection = await userB('/api/places', jsonOptions('POST', { name: '침범', category: '기타', latitude: 37, longitude: 127, collectionId: collectionA.body.item.id }));
    assert.equal(crossCollection.response.status, 400);

    const invalidJson = await userA('/api/places', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(invalidJson.response.status, 400);
    const wrongOrigin = await userA('/api/collections', { ...jsonOptions('POST', { name: '차단' }), headers: { 'content-type': 'application/json', origin: 'https://example.com' } });
    assert.equal(wrongOrigin.response.status, 403);

    const index = await fetch(`${baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /^text\/html/);
    assert.match(await index.text(), /<title>여기였지<\/title>/);
    for (const asset of ['styles.css', 'supabase-auth.js', 'data-store.js', 'auth-controller.js', 'app.js', 'service-worker.js', 'manifest.json']) {
      assert.equal((await fetch(`${baseUrl}/${asset}`)).status, 200, `${asset} 정적 경로`);
    }

    const duplicateClients = Array.from({ length: 2 }, () => createClient());
    const duplicateResults = await Promise.all(duplicateClients.map(client => client('/api/auth/register', jsonOptions('POST', { email: 'race@example.com', password: 'password-R', displayName: 'Race' }))));
    assert.deepEqual(duplicateResults.map(result => result.response.status).sort(), [201, 409]);
    assert.equal(duplicateResults.filter(result => result.body.error === 'email_exists').length, 1);

    const concurrentUser = createClient();
    const concurrentRegistration = await concurrentUser('/api/auth/register', jsonOptions('POST', { email: 'concurrent@example.com', password: 'password-C', displayName: 'Concurrent' }));
    assert.equal(concurrentRegistration.response.status, 201);
    const concurrentPlaces = await Promise.all(Array.from({ length: 10 }, (_, index) => concurrentUser('/api/places', jsonOptions('POST', { name: `Concurrent place ${index}`, category: 'test', latitude: 37 + index / 100, longitude: 127 }))));
    assert.ok(concurrentPlaces.every(result => result.response.status === 201));
    assert.equal((await concurrentUser('/api/places')).body.items.length, 10);
    const concurrentCollections = await Promise.all(Array.from({ length: 10 }, (_, index) => concurrentUser('/api/collections', jsonOptions('POST', { name: `Concurrent collection ${index}`, privacy: 'private' }))));
    assert.ok(concurrentCollections.every(result => result.response.status === 201));
    assert.equal((await concurrentUser('/api/collections')).body.items.length, 10);

    console.log('API tests passed: 20 baseline plus concurrent registration, place, and collection scenarios');
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    assert.deepEqual(fs.readFileSync(realDataFile), realDataBefore, '실제 store.json은 변경되면 안 됩니다.');
  }
})().catch(error => {
  console.error(error);
  child.kill();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  process.exitCode = 1;
});
