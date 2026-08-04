'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('apps/web-prototype/data-store.js', 'utf8');

function createContext(location, responses, auth = {}) {
  const values = new Map();
  const calls = [];
  const optionsLog = [];
  const fetch = async (path, options) => {
    calls.push(path);
    optionsLog.push({ path, options });
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
  context.window.YYJSupabaseAuth = { initialize: () => {}, getAccessToken: auth.getAccessToken || (async () => null), signOut: auth.signOut || (async () => {}) };
  vm.runInNewContext(source, context, { filename: 'data-store.js' });
  return { store: context.window.YYJDataStore, calls, values, optionsLog };
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

(async () => {
  await assertRenderHttps();
  await assertLocalhost();
  await assertStaticHttpsFallback();
  await assertFileProtocol();
  await assertBearerAndAuthErrors();
  console.log('Web datastore tests passed: Render HTTPS, localhost, static HTTPS fallback, and file protocol');
})().catch(error => { console.error(`Web datastore tests failed: ${error.message}`); process.exitCode = 1; });
