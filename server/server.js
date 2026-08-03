'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { createStorage } = require('./storage');
const { hashPassword, verifyPassword } = require('./auth/password');

const PORT = Number(process.env.PORT || 4100);
const DATA_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(__dirname, 'data', 'store.json');
const storage = createStorage({ dataFile: DATA_FILE });
const WEB_ROOT = path.resolve(__dirname, '..', 'apps', 'web-prototype');
const SESSION_COOKIE = 'yyj_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function json(res, status, payload, headers = {}) {
  const body = status === 204 ? '' : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function authJson(res, status, payload, headers = {}) {
  return json(res, status, payload, { 'Cache-Control': 'no-store', ...headers });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      raw += chunk;
      if (Buffer.byteLength(raw) > 2_000_000) {
        settled = true;
        reject(new Error('Payload too large'));
        req.resume();
      }
    });
    req.on('end', () => {
      if (settled) return;
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(header = '') {
  return header.split(';').reduce((result, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return result;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { result[key] = decodeURIComponent(value); } catch { result[key] = value; }
    return result;
  }, {});
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

async function getAuthenticatedUser(req, storage) {
  const sessionToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!sessionToken) return null;
  const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
  const session = await storage.findSessionByTokenHash(tokenHash);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await storage.deleteSession(tokenHash);
    return null;
  }
  const user = await storage.findUserById(session.userId);
  if (!user || !user.passwordHash || !user.passwordSalt) {
    await storage.deleteSession(tokenHash);
    return null;
  }
  return { user, sessionToken };
}

async function requireUser(req, res, storage) {
  const auth = await getAuthenticatedUser(req, storage);
  if (!auth) {
    authJson(res, 401, { error: 'unauthorized', message: '로그인이 필요합니다.' });
    return null;
  }
  return auth;
}

async function createSession(storage, userId) {
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const now = createdAt.toISOString();
  await storage.deleteExpiredSessions(now);
  await storage.createSession({ tokenHash: crypto.createHash('sha256').update(sessionToken).digest('hex'), userId, createdAt: now, expiresAt: new Date(createdAt.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString() });
  return sessionToken;
}

function requestProtocol(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (forwarded === 'http' || forwarded === 'https') return forwarded;
  return req.socket.encrypted ? 'https' : 'http';
}

function sessionCookie(req, sessionId, maxAge = SESSION_MAX_AGE_SECONDS) {
  const secure = process.env.NODE_ENV === 'production' || requestProtocol(req) === 'https';
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function validateRegistration(body) {
  const email = normalizeEmail(body.email);
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const password = body.password;
  if (!email) return { error: '올바른 이메일을 입력해 주세요.' };
  if (!displayName || displayName.length > 40) return { error: '표시 이름은 1자 이상 40자 이하로 입력해 주세요.' };
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return { error: '비밀번호는 8자 이상 128자 이하로 입력해 주세요.' };
  return { email, displayName, password };
}

function validatePlace(body) {
  const errors = [];
  if (typeof body.name !== 'string' || !body.name.trim()) errors.push('name is required');
  if (typeof body.category !== 'string' || !body.category.trim()) errors.push('category is required');
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (body.latitude === null || body.latitude === '' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) errors.push('latitude must be between -90 and 90');
  if (body.longitude === null || body.longitude === '' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) errors.push('longitude must be between -180 and 180');
  if (body.privacy && !['private', 'link', 'public'].includes(body.privacy)) errors.push('invalid privacy');
  if (typeof body.imageUrl === 'string' && (body.imageUrl.startsWith('data:') || body.imageUrl.length > 2048)) errors.push('imageUrl must be a short external URL');
  return errors;
}

function validateMutationRequest(req, url, res) {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (origin && origin !== url.origin) {
    json(res, 403, { error: 'invalid_origin', message: '허용되지 않은 요청 출처입니다.' });
    return false;
  }
  if (['POST', 'PUT'].includes(req.method) && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    json(res, 400, { error: 'json_required', message: 'JSON 형식의 요청만 허용됩니다.' });
    return false;
  }
  return true;
}

function serveStatic(req, res, pathname) {
  const route = pathname === '/' ? '/index.html' : pathname;
  const full = path.resolve(WEB_ROOT, '.' + route);
  if (!full.startsWith(WEB_ROOT + path.sep) && full !== WEB_ROOT) return false;
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return false;
  const ext = path.extname(full);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const protocol = requestProtocol(req);
  const url = new URL(req.url, `${protocol}://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  try {
    if (!validateMutationRequest(req, url, res)) return;
    if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'yeogiyeotji-api', time: new Date().toISOString() });

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody(req);
      const valid = validateRegistration(body);
      if (valid.error) return authJson(res, 400, { error: 'validation_error', message: valid.error });
      const password = hashPassword(valid.password);
      const user = { id: crypto.randomUUID(), email: valid.email, displayName: valid.displayName, ...password, createdAt: new Date().toISOString() };
      try { await storage.createUser(user); } catch (error) {
        if (error.code === 'EMAIL_EXISTS') return authJson(res, 409, { error: 'email_exists', message: '이미 가입된 이메일입니다.' });
        throw error;
      }
      const sessionToken = await createSession(storage, user.id);
      return authJson(res, 201, { item: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, sessionToken) });
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const user = email ? await storage.findUserByEmail(email) : null;
      if (typeof body.password !== 'string' || !user || !verifyPassword(body.password, user)) return authJson(res, 401, { error: 'invalid_credentials', message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      const sessionToken = await createSession(storage, user.id);
      return authJson(res, 200, { item: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, sessionToken) });
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (sessionId) await storage.deleteSession(crypto.createHash('sha256').update(sessionId).digest('hex'));
      return authJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const auth = await requireUser(req, res, storage);
      if (!auth) return;
      return authJson(res, 200, { item: publicUser(auth.user) });
    }

    if (pathname === '/api/places' && req.method === 'GET') {
      const auth = await requireUser(req, res, storage); if (!auth) return;
      const category = url.searchParams.get('category');
      const query = (url.searchParams.get('q') || '').toLowerCase();
      let items = await storage.listPlaces(auth.user.id);
      if (category) items = items.filter(place => place.category === category);
      if (query) items = items.filter(place => [place.name, place.memo, ...(place.tags || [])].join(' ').toLowerCase().includes(query));
      return authJson(res, 200, { items });
    }

    if (pathname === '/api/places' && req.method === 'POST') {
      const auth = await requireUser(req, res, storage); if (!auth) return;
      const body = await readBody(req);
      const errors = validatePlace(body);
      if (body.collectionId && !(await storage.findCollectionById(auth.user.id, body.collectionId))) errors.push('collectionId is not available');
      if (errors.length) return json(res, 400, { error: 'validation_error', details: errors });
      const place = { id: crypto.randomUUID(), ownerId: auth.user.id, name: body.name.trim(), category: body.category.trim(), memo: String(body.memo || '').trim(), tags: Array.isArray(body.tags) ? body.tags.map(String) : [], visitedAt: body.visitedAt || new Date().toISOString().slice(0, 10), latitude: Number(body.latitude), longitude: Number(body.longitude), collectionId: body.collectionId || null, privacy: body.privacy || 'private', imageUrl: body.imageUrl || null, createdAt: new Date().toISOString() };
      await storage.createPlace(place); return json(res, 201, { item: place });
    }

    const placeMatch = pathname.match(/^\/api\/places\/([^/]+)$/);
    if (placeMatch && req.method === 'GET') {
      const auth = await requireUser(req, res, storage); if (!auth) return;
      const item = await storage.findPlaceById(auth.user.id, placeMatch[1]);
      return item ? authJson(res, 200, { item }) : json(res, 404, { error: 'not_found' });
    }
    if (placeMatch && req.method === 'PUT') {
      const auth = await requireUser(req, res, storage); if (!auth) return;
      const current = await storage.findPlaceById(auth.user.id, placeMatch[1]);
      if (!current) return json(res, 404, { error: 'not_found' });
      const body = await readBody(req);
      const merged = { ...current, ...body, id: current.id, ownerId: auth.user.id };
      const errors = validatePlace(merged);
      if (merged.collectionId && !(await storage.findCollectionById(auth.user.id, merged.collectionId))) errors.push('collectionId is not available');
      if (errors.length) return json(res, 400, { error: 'validation_error', details: errors });
      const updated = await storage.updatePlace(auth.user.id, placeMatch[1], merged);
      return updated ? json(res, 200, { item: updated }) : json(res, 404, { error: 'not_found' });
    }
    if (placeMatch && req.method === 'DELETE') {
      const auth = await requireUser(req, res, storage); if (!auth) return;
      const deleted = await storage.deletePlace(auth.user.id, placeMatch[1]);
      return deleted ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not_found' });
    }

    if (pathname === '/api/collections' && req.method === 'GET') {
      const auth = await requireUser(req, res, storage); if (!auth) return;
      return authJson(res, 200, { items: await storage.listCollections(auth.user.id) });
    }
    if (pathname === '/api/collections' && req.method === 'POST') {
      const auth = await requireUser(req, res, storage); if (!auth) return;
      const body = await readBody(req);
      if (typeof body.name !== 'string' || !body.name.trim()) return json(res, 400, { error: 'name_required', message: '컬렉션 이름을 입력해 주세요.' });
      if (body.name.trim().length > 60) return json(res, 400, { error: 'name_too_long', message: '컬렉션 이름은 60자까지 입력할 수 있습니다.' });
      if (!['private', 'link'].includes(body.privacy)) return json(res, 400, { error: 'invalid_privacy', message: '공개 범위를 확인해 주세요.' });
      const collection = { id: crypto.randomUUID(), ownerId: auth.user.id, name: body.name.trim(), privacy: body.privacy, shareToken: body.privacy === 'link' ? crypto.randomBytes(16).toString('hex') : null, createdAt: new Date().toISOString() };
      await storage.createCollection(collection); return json(res, 201, { item: collection });
    }

    const shareMatch = pathname.match(/^\/api\/shared\/([^/]+)$/);
    if (shareMatch && req.method === 'GET') {
      const collection = (await storage.initialize()).collections.find(item => item.shareToken === shareMatch[1] && item.privacy === 'link');
      if (!collection) return json(res, 404, { error: 'not_found' });
      const places = (await storage.listPlaces(collection.ownerId)).filter(place => place.collectionId === collection.id);
      return json(res, 200, { collection: { id: collection.id, name: collection.name }, places });
    }
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'route_not_found' });
    if (serveStatic(req, res, pathname)) return;
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    const status = error.message === 'Payload too large' ? 413 : error.message === 'Invalid JSON' ? 400 : 500;
    const payload = status === 400 ? { error: 'invalid_json', message: 'JSON 형식이 올바르지 않습니다.' } : status === 413 ? { error: 'payload_too_large', message: '요청 데이터가 너무 큽니다.' } : { error: 'server_error', message: '서버에서 오류가 발생했습니다.' };
    return json(res, status, payload);
  }
});

const cleanupTimer = setInterval(() => storage.deleteExpiredSessions(new Date().toISOString()).catch(() => {}), 60 * 60 * 1000);
cleanupTimer.unref();

storage.initialize().then(() => server.listen(PORT, '0.0.0.0', () => {
  console.log(`여기였지 API: http://localhost:${PORT}`);
  console.log(`웹 프로토타입: http://localhost:${PORT}/`);
})).catch(error => {
  console.error('Storage initialization failed:', error.message);
  process.exitCode = 1;
});
