'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const port = 4199;
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  try {
    await wait(500);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.json());
    assert.equal(health.ok, true);
    const before = await fetch(`http://127.0.0.1:${port}/api/places`).then(r => r.json());
    const created = await fetch(`http://127.0.0.1:${port}/api/places`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '테스트 장소', category: '카페', latitude: 37.5, longitude: 127, memo: 'API 테스트', tags: ['테스트'] }) }).then(r => r.json());
    assert.ok(created.item.id);
    const one = await fetch(`http://127.0.0.1:${port}/api/places/${created.item.id}`).then(r => r.json());
    assert.equal(one.item.name, '테스트 장소');
    await fetch(`http://127.0.0.1:${port}/api/places/${created.item.id}`, { method: 'DELETE' });
    const after = await fetch(`http://127.0.0.1:${port}/api/places`).then(r => r.json());
    assert.equal(after.items.length, before.items.length);
    console.log('API tests passed');
  } finally { child.kill(); }
})().catch(error => { console.error(error); child.kill(); process.exit(1); });
