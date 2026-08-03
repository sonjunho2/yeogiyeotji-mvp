'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('apps/web-prototype/data-store.js', 'utf8');

function createContext(location, responses) {
  const values = new Map();
  const calls = [];
  const fetch = async (path) => {
    calls.push(path);
    const response = responses[path];
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
  context.window = context.window;
  vm.runInNewContext(source, context, { filename: 'data-store.js' });
  return { store: context.window.YYJDataStore, calls, values };
}

const seeds = {
  places: [{ id: 'seed-place', name: 'Seed place', category: 'test', latitude: 1, longitude: 2 }],
  collections: [{ id: 'seed-collection', name: 'Seed collection', privacy: 'private' }]
};
const ok = body => ({ ok: true, status: 200, body: JSON.stringify(body) });
const unauthorized = { ok: false, status: 401, body: JSON.stringify({ message: 'unauthorized' }) };

async function assertRenderHttps() {
  const { store, calls } = createContext({ protocol: 'https:', hostname: 'yeogiyeotji-mvp.onrender.com' }, { '/api/health': ok({ ok: true }), '/api/auth/me': unauthorized });
  const result = await store.initialize(seeds.places, seeds.collections);
  assert.equal(result.mode, 'server');
  assert.equal(result.fallback, false);
  assert.equal(result.authRequired, true);
  assert.equal(result.places.length, 0);
  assert.equal(result.collections.length, 0);
  assert.deepEqual(calls, ['/api/health', '/api/auth/me']);
}

async function assertLocalhost() {
  const { store } = createContext({ protocol: 'http:', hostname: 'localhost' }, { '/api/health': ok({ ok: true }), '/api/auth/me': unauthorized });
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

(async () => {
  await assertRenderHttps();
  await assertLocalhost();
  await assertStaticHttpsFallback();
  await assertFileProtocol();
  console.log('Web datastore tests passed: Render HTTPS, localhost, static HTTPS fallback, and file protocol');
})().catch(error => { console.error(`Web datastore tests failed: ${error.message}`); process.exitCode = 1; });
