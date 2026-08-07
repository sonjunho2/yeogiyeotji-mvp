'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('apps/web-prototype/service-worker.js', 'utf8');

function loadWorker(keys = [], options = {}) {
  const listeners = {};
  const calls = { opened: [], added: [], deleted: [], matched: 0, cacheMatched: 0, puts: 0, putRequests: [], putResponses: [], skipWaiting: 0, claim: 0 };
  const cache = { addAll: async assets => calls.added.push(assets), match: async () => { calls.cacheMatched += 1; return null; }, put: async (request, response) => { calls.puts += 1; calls.putRequests.push(request); calls.putResponses.push(response); } };
  let fetchCount = 0;
  const fetched = [];
  const responses = [];
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
      match: async () => { calls.matched += 1; return null; }
    },
    fetch: async request => { fetchCount += 1; fetched.push(request); if (options.fetchReject) throw new Error(options.fetchReject); const response = request.networkResponse || { ok: true, clone: () => ({}) }; responses.push(response); return response; },
    URL
  };
  vm.runInNewContext(source, context, { filename: 'service-worker.js' });
  return { listeners, calls, fetchCount: () => fetchCount, fetched, responses };
}

async function runEvent(handler) {
  let promise;
  handler({ waitUntil: value => { promise = value; } });
  await promise;
}

(async () => {
  const install = loadWorker();
  await runEvent(install.listeners.install);
  assert.deepEqual(install.calls.opened, ['yeogiyeotji-v14']);
  assert.equal(install.calls.added.length, 1);
  assert.ok(install.calls.added[0].includes('./data-store.js'));
  assert.ok(install.calls.added[0].includes('./supabase-auth.js'));
  assert.ok(install.calls.added[0].includes('./auth-controller.js'));
  assert.ok(install.calls.added[0].includes('./map-polish.css'));
  assert.ok(install.calls.added[0].includes('./memories-polish.css'));
  assert.ok(install.calls.added[0].includes('./add-polish.css'));
  assert.equal(install.calls.skipWaiting, 1);

  const activate = loadWorker(['yeogiyeotji-v6', 'yeogiyeotji-v7', 'yeogiyeotji-v8', 'yeogiyeotji-v9', 'yeogiyeotji-v10', 'yeogiyeotji-v11', 'yeogiyeotji-v12', 'yeogiyeotji-v13', 'unrelated-old-cache']);
  await runEvent(activate.listeners.activate);
  assert.deepEqual(activate.calls.deleted.sort(), ['unrelated-old-cache', 'yeogiyeotji-v10', 'yeogiyeotji-v11', 'yeogiyeotji-v12', 'yeogiyeotji-v13', 'yeogiyeotji-v6', 'yeogiyeotji-v7', 'yeogiyeotji-v8', 'yeogiyeotji-v9']);
  assert.equal(activate.calls.deleted.includes('yeogiyeotji-v8'), true);
  assert.equal(activate.calls.claim, 1);

  const worker = loadWorker();
  const apiPaths = ['/api/auth/config', '/api/health', '/api/auth/session', '/api/places'];
  for (const path of apiPaths) {
    const request = { method: 'GET', url: `https://example.test${path}${path === '/api/auth/config' ? '?refresh=1' : ''}` };
    const networkResponse = { path, ok: true };
    request.networkResponse = networkResponse;
    const originalFetchCount = worker.fetchCount();
    let responsePromise;
    worker.listeners.fetch({ request, respondWith: promise => { responsePromise = promise; } });
    assert.equal(worker.fetchCount(), originalFetchCount + 1);
    assert.strictEqual(worker.fetched.at(-1), request);
    assert.equal(worker.calls.matched, 0);
    assert.equal(worker.calls.opened.length, 0);
    assert.equal(worker.calls.cacheMatched, 0);
    assert.equal(worker.calls.puts, 0);
    assert.strictEqual(await responsePromise, networkResponse);
  }
  const staticRequest = { method: 'GET', url: 'https://example.test/app.js' };
  let staticResponsePromise;
  worker.listeners.fetch({ request: staticRequest, respondWith: promise => { staticResponsePromise = promise; } });
  assert.equal(worker.calls.matched, 1);
  await staticResponsePromise;
  assert.equal(worker.fetchCount(), 5);
  assert.strictEqual(worker.fetched.at(-1), staticRequest);
  assert.equal(worker.calls.opened.length, 1);
  assert.equal(worker.calls.opened[0], 'yeogiyeotji-v14');
  assert.equal(worker.calls.puts, 1);
  assert.strictEqual(worker.calls.putRequests[0], staticRequest);
  assert.notStrictEqual(worker.calls.putResponses[0], worker.responses[4]);
  assert.strictEqual(await staticResponsePromise, worker.responses[4]);

  const apiaryWorker = loadWorker();
  const apiaryRequest = { method: 'GET', url: 'https://example.test/apiary/image.png' };
  const apiaryResponse = { ok: true, marker: 'apiary', clone: () => ({ cloned: true }) };
  apiaryRequest.networkResponse = apiaryResponse;
  let apiaryResponsePromise;
  apiaryWorker.listeners.fetch({ request: apiaryRequest, respondWith: promise => { apiaryResponsePromise = promise; } });
  assert.ok(apiaryResponsePromise);
  assert.strictEqual(await apiaryResponsePromise, apiaryResponse);
  assert.equal(apiaryWorker.calls.matched, 1);
  assert.equal(apiaryWorker.fetchCount(), 1);
  assert.strictEqual(apiaryWorker.fetched[0], apiaryRequest);
  assert.equal(apiaryWorker.calls.opened.length, 1);
  assert.equal(apiaryWorker.calls.puts, 1);
  assert.strictEqual(apiaryWorker.calls.putRequests[0], apiaryRequest);
  assert.notStrictEqual(apiaryWorker.calls.putResponses[0], apiaryResponse);

  const externalWorker = loadWorker();
  const externalRequest = { method: 'GET', url: 'https://cdn.example.test/sdk.js' };
  let externalResponded = 0;
  externalWorker.listeners.fetch({ request: externalRequest, respondWith: () => { externalResponded += 1; } });
  assert.equal(externalResponded, 0);
  assert.equal(externalWorker.fetchCount(), 0);
  assert.equal(externalWorker.calls.matched, 0);
  assert.equal(externalWorker.calls.opened.length, 0);
  assert.equal(externalWorker.calls.puts, 0);

  const postWorker = loadWorker();
  const postRequest = { method: 'POST', url: 'https://example.test/app.js' };
  let postResponded = 0;
  postWorker.listeners.fetch({ request: postRequest, respondWith: () => { postResponded += 1; } });
  assert.equal(postResponded, 0);
  assert.equal(postWorker.fetchCount(), 0);
  assert.equal(postWorker.calls.matched, 0);
  assert.equal(postWorker.calls.opened.length, 0);
  assert.equal(postWorker.calls.puts, 0);

  const failedApiWorker = loadWorker([], { fetchReject: 'api network unavailable' });
  const failedApiRequest = { method: 'GET', url: 'https://example.test/api/auth/config' };
  let failedApiResponsePromise;
  failedApiWorker.listeners.fetch({ request: failedApiRequest, respondWith: promise => { failedApiResponsePromise = promise; } });
  await assert.rejects(failedApiResponsePromise, /api network unavailable/);
  assert.equal(failedApiWorker.calls.matched, 0);
  assert.equal(failedApiWorker.calls.opened.length, 0);
  assert.equal(failedApiWorker.calls.cacheMatched, 0);
  assert.equal(failedApiWorker.calls.puts, 0);

  console.log('Service worker tests passed: v14 assets, stale cache cleanup, and fetch exclusions');
})().catch(error => { console.error(`Service worker tests failed: ${error.message}`); process.exitCode = 1; });
