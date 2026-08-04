'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('apps/web-prototype/service-worker.js', 'utf8');

function loadWorker(keys = []) {
  const listeners = {};
  const calls = { opened: [], added: [], deleted: [], skipWaiting: 0, claim: 0 };
  const cache = { addAll: async assets => calls.added.push(assets), put: async () => {} };
  let fetchCount = 0;
  const context = {
    self: {
      location: { origin: 'https://example.test' },
      clients: { claim: async () => { calls.claim += 1; } },
      skipWaiting: async () => { calls.skipWaiting += 1; },
      addEventListener: (name, handler) => { listeners[name] = handler; }
    },
    caches: {
      open: async name => { calls.opened.push(name); return cache; },
      keys: async () => keys,
      delete: async name => { calls.deleted.push(name); return true; },
      match: async () => null
    },
    fetch: async request => { fetchCount += 1; return { ok: true, clone: () => ({}) }; },
    URL
  };
  vm.runInNewContext(source, context, { filename: 'service-worker.js' });
  return { listeners, calls, fetchCount: () => fetchCount };
}

async function runEvent(handler) {
  let promise;
  handler({ waitUntil: value => { promise = value; } });
  await promise;
}

(async () => {
  const install = loadWorker();
  await runEvent(install.listeners.install);
  assert.deepEqual(install.calls.opened, ['yeogiyeotji-v7']);
  assert.equal(install.calls.added.length, 1);
  assert.ok(install.calls.added[0].includes('./data-store.js'));
  assert.ok(install.calls.added[0].includes('./supabase-auth.js'));
  assert.equal(install.calls.skipWaiting, 1);

  const activate = loadWorker(['yeogiyeotji-v6', 'yeogiyeotji-v7', 'unrelated-old-cache']);
  await runEvent(activate.listeners.activate);
  assert.deepEqual(activate.calls.deleted.sort(), ['unrelated-old-cache', 'yeogiyeotji-v6']);
  assert.equal(activate.calls.deleted.includes('yeogiyeotji-v7'), false);
  assert.equal(activate.calls.claim, 1);

  const worker = loadWorker();
  let responded = 0;
  worker.listeners.fetch({ request: { method: 'GET', url: 'https://example.test/api/health' }, respondWith: () => { responded += 1; } });
  worker.listeners.fetch({ request: { method: 'GET', url: 'https://cdn.example.test/sdk.js' }, respondWith: () => { responded += 1; } });
  worker.listeners.fetch({ request: { method: 'GET', url: 'https://example.test/app.js' }, respondWith: () => { responded += 1; } });
  worker.listeners.fetch({ request: { method: 'POST', url: 'https://example.test/app.js' }, respondWith: () => { responded += 1; } });
  assert.equal(responded, 1);

  console.log('Service worker tests passed: v7 assets, stale cache cleanup, and fetch exclusions');
})().catch(error => { console.error(`Service worker tests failed: ${error.message}`); process.exitCode = 1; });
