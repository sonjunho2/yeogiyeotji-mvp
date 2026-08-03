'use strict';

const crypto = require('node:crypto');
const { createPool } = require('./db/pool');
const { migrate } = require('./db/migrate');
const { createPostgresStorage } = require('./storage/postgres-storage');

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log('PostgreSQL tests skipped: TEST_DATABASE_URL is not set');
  process.exit(0);
}

const schema = `yyj_test_${crypto.randomBytes(8).toString('hex')}`;
const quoteIdentifier = value => `"${value.replace(/"/g, '""')}"`;
const received = value => Array.isArray(value) ? `array(length=${value.length})` : value === null ? 'null' : value === undefined ? 'undefined' : typeof value === 'boolean' ? String(value) : typeof value;
function expectValue(name, actual, expected) {
  const matches = expected === 'array' ? Array.isArray(actual) : expected === 'null' ? actual === null : expected === 'false' ? actual === false : expected === 'true' ? actual === true : actual === expected;
  if (!matches) throw new Error(`${name} failed: expected ${expected}, received ${received(actual)}`);
}
function expectArrayLength(name, actual, length) {
  if (!Array.isArray(actual) || actual.length !== length) throw new Error(`${name} failed: expected array(length=${length}), received ${received(actual)}`);
}
let adminPool;
let testPool;

(async () => {
  adminPool = createPool({ connectionString: url });
  await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  testPool = createPool({ connectionString: url, options: `-c search_path=${quoteIdentifier(schema)},pg_catalog` });
  await migrate({ pool: testPool });
  const storage = createPostgresStorage({ pool: testPool });
  await storage.initialize();

  const userA = { id: crypto.randomUUID(), email: 'pg-a@example.com', displayName: 'A', passwordSalt: 'salt', passwordHash: 'hash', createdAt: new Date().toISOString() };
  const userB = { id: crypto.randomUUID(), email: 'pg-b@example.com', displayName: 'B', passwordSalt: 'salt', passwordHash: 'hash', createdAt: new Date().toISOString() };
  await storage.createUser(userA);
  await storage.createUser(userB);
  if ((await storage.findUserByEmail(userA.email)).id !== userA.id) throw new Error('findUserByEmail failed');
  try { await storage.createUser({ ...userA, id: crypto.randomUUID() }); throw new Error('duplicate email was accepted'); } catch (error) { if (error.code !== 'EMAIL_EXISTS') throw error; }

  const collection = await storage.createCollection({ id: crypto.randomUUID(), ownerId: userA.id, name: 'PG test', privacy: 'private', shareToken: null, createdAt: new Date().toISOString() });
  const collectionB = await storage.createCollection({ id: crypto.randomUUID(), ownerId: userB.id, name: 'PG B test', privacy: 'private', shareToken: null, createdAt: new Date().toISOString() });
  const place = await storage.createPlace({ id: crypto.randomUUID(), ownerId: userA.id, name: 'PG place', category: 'test', memo: '', tags: [], visitedAt: '2026-08-03', latitude: 37, longitude: 127, collectionId: collection.id, privacy: 'private', imageUrl: null, createdAt: new Date().toISOString() });
  expectArrayLength('collection list isolation', (await storage.listCollections(userB.id)).filter(item => item.id === collection.id), 0);
  expectValue('collection item isolation', await storage.findCollectionById(userB.id, collection.id), 'null');
  expectArrayLength('place list isolation', (await storage.listPlaces(userB.id)).filter(item => item.id === place.id), 0);
  expectValue('place item isolation', await storage.findPlaceById(userB.id, place.id), 'null');
  expectValue('place update isolation', await storage.updatePlace(userB.id, place.id, { ...place, ownerId: userB.id, name: 'Should not update' }), 'null');
  expectValue('place delete isolation', await storage.deletePlace(userB.id, place.id), 'false');
  const unchanged = await storage.findPlaceById(userA.id, place.id);
  if (!unchanged || unchanged.name !== 'PG place' || unchanged.ownerId !== userA.id) throw new Error('place update/delete isolation failed: expected original owner place, received object');

  const beforeAttachment = (await storage.listPlaces(userB.id)).length;
  try {
    await storage.createPlace({ id: crypto.randomUUID(), ownerId: userB.id, name: 'Cross owner', category: 'test', memo: '', tags: [], visitedAt: '2026-08-03', latitude: 37, longitude: 127, collectionId: collection.id, privacy: 'private', imageUrl: null, createdAt: new Date().toISOString() });
    throw new Error('cross-owner collection attachment failed: expected foreign-key rejection, received success');
  } catch (error) {
    if (error.message.startsWith('cross-owner collection attachment failed:')) throw error;
  }
  expectArrayLength('cross-owner collection attachment', await storage.listPlaces(userB.id), beforeAttachment);
  const ungrouped = await storage.createPlace({ id: crypto.randomUUID(), ownerId: userB.id, name: 'Ungrouped', category: 'test', memo: '', tags: [], visitedAt: '2026-08-03', latitude: 37, longitude: 127, collectionId: null, privacy: 'private', imageUrl: null, createdAt: new Date().toISOString() });
  if (ungrouped.collectionId !== null) throw new Error('null collection attachment failed: expected null, received object');
  const ownPlace = await storage.createPlace({ id: crypto.randomUUID(), ownerId: userB.id, name: 'Own collection', category: 'test', memo: '', tags: [], visitedAt: '2026-08-03', latitude: 37, longitude: 127, collectionId: collectionB.id, privacy: 'private', imageUrl: null, createdAt: new Date().toISOString() });
  if (ownPlace.collectionId !== collectionB.id) throw new Error('own collection attachment failed: expected own collection, received object');
  const updated = await storage.updatePlace(userA.id, place.id, { ...place, ownerId: userB.id, name: 'Updated' });
  if (!updated || updated.ownerId !== userA.id || updated.name !== 'Updated') throw new Error('place update failed: expected owner A and Updated, received object');
  const deleteTarget = await storage.createPlace({ id: crypto.randomUUID(), ownerId: userA.id, name: 'Delete target', category: 'test', memo: '', tags: [], visitedAt: '2026-08-03', latitude: 37, longitude: 127, collectionId: null, privacy: 'private', imageUrl: null, createdAt: new Date().toISOString() });
  expectValue('place delete precondition', Boolean(await storage.findPlaceById(userA.id, deleteTarget.id)), 'true');
  expectValue('place delete other owner', await storage.deletePlace(userB.id, deleteTarget.id), 'false');
  expectValue('place delete after other owner', Boolean(await storage.findPlaceById(userA.id, deleteTarget.id)), 'true');
  expectValue('place delete', await storage.deletePlace(userA.id, deleteTarget.id), 'true');
  expectValue('place delete after owner', await storage.findPlaceById(userA.id, deleteTarget.id), 'null');
  console.log('PostgreSQL tests passed: isolated schema, migration, CRUD, ownership, and duplicate-email behavior');
})().catch(error => { console.error(`PostgreSQL tests failed: ${error.message}`); process.exitCode = 1; }).finally(async () => {
  if (testPool) await testPool.end();
  if (adminPool) { try { await adminPool.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`); } finally { await adminPool.end(); } }
});
