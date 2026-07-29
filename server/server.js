'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 4100);
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const WEB_ROOT = path.resolve(__dirname, '..', 'apps', 'web-prototype');

function seed() {
  return {
    users: [{ id: 'demo-user', name: '준호', email: 'demo@example.com' }],
    collections: [
      { id: 'c1', userId: 'demo-user', name: '제주·강릉 다시 갈 곳', privacy: 'link', shareToken: 'demo-share' },
      { id: 'c2', userId: 'demo-user', name: '가족과 갈 식당', privacy: 'private', shareToken: null },
      { id: 'c3', userId: 'demo-user', name: '사고 싶은 물건 판매처', privacy: 'private', shareToken: null },
    ],
    places: [
      { id: 'p1', userId: 'demo-user', name: '강릉 바다 창가 카페', category: '카페', memo: '창가 자리에서 바다가 잘 보였고 평일 오전에는 사람이 적었음', tags: ['바다전망', '다시갈곳'], visitedAt: '2026-05-18', latitude: 37.772, longitude: 128.947, collectionId: 'c1', privacy: 'private', imageUrl: null, createdAt: new Date().toISOString() },
      { id: 'p2', userId: 'demo-user', name: '성수동 소품숍', category: '쇼핑', memo: '선물하기 좋았던 가죽가방을 발견함', tags: ['쇼핑', '선물'], visitedAt: '2026-07-24', latitude: 37.544, longitude: 127.056, collectionId: 'c3', privacy: 'private', imageUrl: null, createdAt: new Date().toISOString() },
    ],
  };
}
function loadStore() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { const data = seed(); saveStore(data); return data; }
}
function saveStore(store) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}
function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 2_000_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function validatePlace(body) {
  const errors = [];
  if (typeof body.name !== 'string' || !body.name.trim()) errors.push('name is required');
  if (typeof body.category !== 'string' || !body.category.trim()) errors.push('category is required');
  if (!Number.isFinite(Number(body.latitude))) errors.push('latitude must be a number');
  if (!Number.isFinite(Number(body.longitude))) errors.push('longitude must be a number');
  if (body.privacy && !['private', 'link', 'public'].includes(body.privacy)) errors.push('invalid privacy');
  return errors;
}
function serveStatic(req, res, pathname) {
  const route = pathname === '/' ? '/index.html' : pathname;
  const full = path.resolve(WEB_ROOT, '.' + route);
  if (!full.startsWith(WEB_ROOT)) return false;
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return false;
  const ext = path.extname(full);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  if (req.method === 'OPTIONS') return json(res, 204, {});
  try {
    const store = loadStore();
    if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'yeogiyeotji-api', time: new Date().toISOString() });

    if (pathname === '/api/places' && req.method === 'GET') {
      const category = url.searchParams.get('category');
      const query = (url.searchParams.get('q') || '').toLowerCase();
      let items = store.places.filter(p => p.userId === 'demo-user');
      if (category) items = items.filter(p => p.category === category);
      if (query) items = items.filter(p => [p.name, p.memo, ...(p.tags || [])].join(' ').toLowerCase().includes(query));
      return json(res, 200, { items });
    }
    if (pathname === '/api/places' && req.method === 'POST') {
      const body = await readBody(req); const errors = validatePlace(body);
      if (errors.length) return json(res, 400, { error: 'validation_error', details: errors });
      const place = { id: crypto.randomUUID(), userId: 'demo-user', name: body.name.trim(), category: body.category.trim(), memo: String(body.memo || '').trim(), tags: Array.isArray(body.tags) ? body.tags.map(String) : [], visitedAt: body.visitedAt || new Date().toISOString().slice(0, 10), latitude: Number(body.latitude), longitude: Number(body.longitude), collectionId: body.collectionId || null, privacy: body.privacy || 'private', imageUrl: body.imageUrl || null, createdAt: new Date().toISOString() };
      store.places.unshift(place); saveStore(store); return json(res, 201, { item: place });
    }
    const placeMatch = pathname.match(/^\/api\/places\/([^/]+)$/);
    if (placeMatch && req.method === 'GET') {
      const item = store.places.find(p => p.id === placeMatch[1]);
      return item ? json(res, 200, { item }) : json(res, 404, { error: 'not_found' });
    }
    if (placeMatch && req.method === 'PUT') {
      const index = store.places.findIndex(p => p.id === placeMatch[1]);
      if (index < 0) return json(res, 404, { error: 'not_found' });
      const body = await readBody(req); const merged = { ...store.places[index], ...body, id: store.places[index].id, userId: store.places[index].userId };
      const errors = validatePlace(merged); if (errors.length) return json(res, 400, { error: 'validation_error', details: errors });
      store.places[index] = merged; saveStore(store); return json(res, 200, { item: merged });
    }
    if (placeMatch && req.method === 'DELETE') {
      const before = store.places.length; store.places = store.places.filter(p => p.id !== placeMatch[1]);
      if (store.places.length === before) return json(res, 404, { error: 'not_found' });
      saveStore(store); return json(res, 200, { ok: true });
    }

    if (pathname === '/api/collections' && req.method === 'GET') return json(res, 200, { items: store.collections.filter(c => c.userId === 'demo-user') });
    if (pathname === '/api/collections' && req.method === 'POST') {
      const body = await readBody(req);
      if (typeof body.name !== 'string' || !body.name.trim()) return json(res, 400, { error: 'name_required' });
      const collection = { id: crypto.randomUUID(), userId: 'demo-user', name: body.name.trim(), privacy: body.privacy === 'link' ? 'link' : 'private', shareToken: body.privacy === 'link' ? crypto.randomBytes(8).toString('hex') : null };
      store.collections.push(collection); saveStore(store); return json(res, 201, { item: collection });
    }
    const shareMatch = pathname.match(/^\/api\/shared\/([^/]+)$/);
    if (shareMatch && req.method === 'GET') {
      const collection = store.collections.find(c => c.shareToken === shareMatch[1]);
      if (!collection) return json(res, 404, { error: 'not_found' });
      const places = store.places.filter(p => p.collectionId === collection.id);
      return json(res, 200, { collection: { id: collection.id, name: collection.name }, places });
    }
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'route_not_found' });
    if (serveStatic(req, res, pathname)) return;
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    return json(res, error.message === 'Payload too large' ? 413 : 500, { error: 'server_error', message: error.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`여기였지 API: http://localhost:${PORT}`);
  console.log(`웹 프로토타입: http://localhost:${PORT}/`);
});
