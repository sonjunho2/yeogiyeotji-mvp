'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = 4199;
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeogiyeotji-test-'));
const dataFile = path.join(temporaryDirectory, 'store.json');
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  env: { ...process.env, PORT: String(port), DATA_FILE: dataFile },
  stdio: ['ignore', 'pipe', 'pipe']
});

const baseUrl = `http://127.0.0.1:${port}`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function jsonRequest(route, options) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  return { response, body };
}

(async () => {
  try {
    await waitForServer();

    const initialPlaces = await jsonRequest('/api/places');
    assert.equal(initialPlaces.response.status, 200);
    assert.ok(Array.isArray(initialPlaces.body.items));

    const createdPlace = await jsonRequest('/api/places', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'API 테스트 장소', category: '카페', latitude: 37.5, longitude: 127, memo: 'API 테스트', tags: ['테스트'] })
    });
    assert.equal(createdPlace.response.status, 201);
    assert.ok(createdPlace.body.item.id);

    const foundPlace = await jsonRequest(`/api/places/${createdPlace.body.item.id}`);
    assert.equal(foundPlace.response.status, 200);
    assert.equal(foundPlace.body.item.name, 'API 테스트 장소');

    const deletedPlace = await jsonRequest(`/api/places/${createdPlace.body.item.id}`, { method: 'DELETE' });
    assert.equal(deletedPlace.response.status, 200);
    assert.equal(deletedPlace.body.ok, true);

    const missingDelete = await jsonRequest('/api/places/does-not-exist', { method: 'DELETE' });
    assert.equal(missingDelete.response.status, 404);

    const invalidPlace = await jsonRequest('/api/places', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', category: '', latitude: '잘못됨', longitude: null })
    });
    assert.equal(invalidPlace.response.status, 400);

    const initialCollections = await jsonRequest('/api/collections');
    assert.equal(initialCollections.response.status, 200);
    assert.ok(Array.isArray(initialCollections.body.items));

    const createdCollection = await jsonRequest('/api/collections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'API 테스트 컬렉션', privacy: 'private' })
    });
    assert.equal(createdCollection.response.status, 201);
    assert.equal(createdCollection.body.item.name, 'API 테스트 컬렉션');

    const index = await fetch(`${baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /^text\/html/);
    assert.match(await index.text(), /<title>여기였지<\/title>/);

    console.log('API tests passed: places CRUD, validation, collections, static index');
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  child.kill();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  process.exitCode = 1;
});
