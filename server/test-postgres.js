'use strict';

const crypto = require('node:crypto');
const { createPool } = require('./db/pool');
const { migrate } = require('./db/migrate');
const { createPostgresStorage } = require('./storage/postgres-storage');
const { buildImportPlan, executeImport } = require('./db/import-json');

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
let importPool;
let importSchema;
let rollbackPool;
let rollbackSchema;

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

  importSchema = `yyj_test_import_${crypto.randomBytes(8).toString('hex')}`;
  await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(importSchema)}`);
  importPool = createPool({ connectionString: url, options: `-c search_path=${quoteIdentifier(importSchema)},pg_catalog` });
  await migrate({ pool: importPool });
  const importUser = { id: crypto.randomUUID(), email: 'import-a@example.com', displayName: 'Import A', passwordHash: 'hash', passwordSalt: 'salt', createdAt: new Date().toISOString() };
  const importCollection = { id: crypto.randomUUID(), ownerId: importUser.id, name: 'Import collection', privacy: 'private', shareToken: null, createdAt: new Date().toISOString() };
  const importPlace = { id: crypto.randomUUID(), ownerId: importUser.id, name: 'Import place', category: 'test', memo: '', tags: ['one', 'two'], visitedAt: '2026-08-03', latitude: 37, longitude: 127, collectionId: null, privacy: 'private', imageUrl: null, createdAt: new Date().toISOString() };
  const importSource = { users: [importUser], collections: [importCollection], places: [importPlace] };
  const importPlan = buildImportPlan(importSource);
  const importResult = await executeImport({ pool: importPool, plan: importPlan });
  if (importResult.importable.users !== 1 || importResult.importable.collections !== 1 || importResult.importable.places !== 1) throw new Error('import execute failed: expected importable counts 1,1,1');
  async function counts(pool) { const result = await pool.query('SELECT (SELECT COUNT(*)::int FROM users) AS users, (SELECT COUNT(*)::int FROM collections) AS collections, (SELECT COUNT(*)::int FROM places) AS places'); return result.rows[0]; }
  const firstCounts = await counts(importPool);
  if (firstCounts.users !== 1 || firstCounts.collections !== 1 || firstCounts.places !== 1) throw new Error('import execute failed: expected row counts 1,1,1');
  const importedUser = (await importPool.query('SELECT * FROM users WHERE id = $1', [importUser.id])).rows[0];
  const importedCollection = (await importPool.query('SELECT * FROM collections WHERE id = $1', [importCollection.id])).rows[0];
  const importedPlace = (await importPool.query('SELECT * FROM places WHERE id = $1', [importPlace.id])).rows[0];
  if (!importedUser || importedUser.id !== importUser.id || importedUser.password_hash !== importUser.passwordHash || importedUser.password_salt !== importUser.passwordSalt || importedUser.created_at.toISOString() !== importUser.createdAt) throw new Error('import field preservation failed: expected user fields');
  if (!importedCollection || importedCollection.id !== importCollection.id || importedCollection.owner_id !== importUser.id) throw new Error('import field preservation failed: expected collection fields');
  if (!importedPlace || importedPlace.id !== importPlace.id || importedPlace.owner_id !== importUser.id || importedPlace.memo !== '' || importedPlace.collection_id !== null || importedPlace.image_url !== null || importedPlace.visited_at !== importPlace.visitedAt || JSON.stringify(importedPlace.tags) !== JSON.stringify(importPlace.tags)) throw new Error('import field preservation failed: expected place fields');
  try { await executeImport({ pool: importPool, plan: importPlan }); throw new Error('import repeat protection failed: expected non-empty table rejection'); } catch (error) { if (error.message.startsWith('import repeat protection failed:')) throw error; }
  const secondCounts = await counts(importPool);
  if (JSON.stringify(firstCounts) !== JSON.stringify(secondCounts)) throw new Error('import repeat protection failed: expected unchanged row counts');

  rollbackSchema = `yyj_test_${crypto.randomBytes(8).toString('hex')}`;
  await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(rollbackSchema)}`);
  rollbackPool = createPool({ connectionString: url, options: `-c search_path=${quoteIdentifier(rollbackSchema)},pg_catalog` });
  await migrate({ pool: rollbackPool });
  const rollbackUser = { ...importUser, id: crypto.randomUUID(), email: 'rollback@example.com' };
  const rollbackPlan = { importable: { users: [rollbackUser], collections: [{ ...importCollection, ownerId: rollbackUser.id }, { ...importCollection, ownerId: rollbackUser.id }], places: [] } };
  try { await executeImport({ pool: rollbackPool, plan: rollbackPlan }); throw new Error('rollback test failed: expected constraint violation'); } catch (error) { if (error.message.startsWith('rollback test failed:')) throw error; }
  const rollbackCounts = await counts(rollbackPool);
  if (rollbackCounts.users !== 0 || rollbackCounts.collections !== 0 || rollbackCounts.places !== 0) throw new Error('rollback test failed: expected row counts 0,0,0');
  await rollbackPool.query('SELECT 1');
  console.log('PostgreSQL tests passed: isolated schema, migration, CRUD, ownership, and duplicate-email behavior');
})().catch(error => { console.error(`PostgreSQL tests failed: ${error.message}`); process.exitCode = 1; }).finally(async () => {
  if (rollbackPool) await rollbackPool.end();
  if (adminPool && rollbackSchema) { try { await adminPool.query(`DROP SCHEMA ${quoteIdentifier(rollbackSchema)} CASCADE`); } catch (_) {} }
  if (importPool) await importPool.end();
  if (adminPool && importSchema) { try { await adminPool.query(`DROP SCHEMA ${quoteIdentifier(importSchema)} CASCADE`); } catch (_) {} }
  if (testPool) await testPool.end();
  if (adminPool) { try { await adminPool.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`); } finally { await adminPool.end(); } }
});
