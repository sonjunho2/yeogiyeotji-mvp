'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorage } = require('./storage');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeogiyeotji-storage-'));
    const file = path.join(directory, 'nested', 'store.json');
    const originalToken = 'json-storage-original-token-fixture';
    const tokenHash = 'a'.repeat(64);
  try {
    const storage = createStorage({ dataFile: file });
    const initial = await storage.load();
    assert.deepEqual(initial, { schemaVersion: 2, users: [], collections: [], places: [] });
    await storage.save({ ...initial, users: [{ id: 'u1', email: 'u@example.com', passwordHash: 'hash', passwordSalt: 'salt' }] });
    assert.equal((await storage.load()).users[0].id, 'u1');
    assert.equal((await storage.findUserByEmail('u@example.com')).id, 'u1');
    await assert.rejects(() => storage.createUser({ id: 'u2', email: 'u@example.com' }), error => error.code === 'EMAIL_EXISTS');
    const users = await Promise.all(Array.from({ length: 8 }, (_, index) => storage.createUser({ id: `u${index + 2}`, email: `u${index + 2}@example.com` })));
    assert.equal(new Set(users.map(user => user.id)).size, 8);
    const session = { tokenHash, userId: 'u1', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' };
    await storage.createSession(session);
    const storedJson = fs.readFileSync(file, 'utf8');
    const parsedJson = JSON.parse(storedJson);
    assert.equal(Object.prototype.hasOwnProperty.call(parsedJson, 'sessions'), false);
    assert.equal(storedJson.includes(tokenHash), false);
    assert.equal(storedJson.includes(originalToken), false);
    await storage.createSession(session);
    assert.deepEqual(await storage.findSessionByTokenHash(session.tokenHash), session);
    assert.equal(await storage.findSessionByTokenHash('b'.repeat(64)), null);
    assert.equal(await storage.deleteSession('b'.repeat(64)), false);
    assert.equal(await storage.deleteSession(session.tokenHash), true);
    await storage.createSession({ ...session, tokenHash: 'c'.repeat(64), expiresAt: '2020-01-01T00:00:00.000Z' });
    assert.equal(await storage.deleteExpiredSessions('2021-01-01T00:00:00.000Z'), 1);
    const collection = await storage.createCollection({ id: 'c1', ownerId: 'u1', name: 'Test' });
    assert.equal((await storage.findCollectionById('u1', collection.id)).id, 'c1');
    assert.equal((await storage.findCollectionById('u2', collection.id)), null);
    const place = await storage.createPlace({ id: 'p1', ownerId: 'u1', name: 'Place' });
    assert.equal((await storage.findPlaceById('u1', place.id)).name, 'Place');
    assert.equal((await storage.updatePlace('u1', place.id, { name: 'Updated' })).name, 'Updated');
    assert.equal(await storage.deletePlace('u2', place.id), false);
    assert.equal(await storage.deletePlace('u1', place.id), true);
    assert.throws(() => createStorage({ driver: 'postgres', dataFile: file }), /DATABASE_URL is required/);
    fs.writeFileSync(file, '{ broken');
    assert.deepEqual(await storage.load(), { schemaVersion: 2, users: [], collections: [], places: [] });
    console.log('Storage tests passed: initialization, persistence, isolation, driver validation, and recovery');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
