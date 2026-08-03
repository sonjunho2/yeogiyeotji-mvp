'use strict';

const crypto = require('node:crypto');
const { createPool } = require('./db/pool');
const { migrate } = require('./db/migrate');
const { createPostgresStorage } = require('./storage/postgres-storage');
const { buildImportPlan, executeImport } = require('./db/import-json');
const { recoverLegacyUser } = require('./db/import-json');
const { hashPassword, verifyPassword } = require('./auth/password');

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
  const importUser = { id: crypto.randomUUID(), email: 'import-a@example.com', displayName: 'Import A', ...hashPassword('Current fixture password 123'), createdAt: new Date().toISOString() };
  const legacyUser = { id: crypto.randomUUID(), email: 'legacy-fixture@example.com', name: 'Legacy fixture' };
  const importCollection = { id: crypto.randomUUID(), ownerId: importUser.id, name: 'Import collection', privacy: 'private', shareToken: null, createdAt: new Date().toISOString() };
  const legacyCollections = [0, 1, 2].map(index => ({ id: crypto.randomUUID(), userId: legacyUser.id, name: `Legacy collection ${index}`, privacy: 'private', shareToken: null }));
  const importPlace = { id: crypto.randomUUID(), ownerId: importUser.id, name: 'Import place', category: 'test', memo: '', tags: ['one', 'two'], visitedAt: '2026-08-03', latitude: 37, longitude: 127, collectionId: null, privacy: 'private', imageUrl: null, createdAt: new Date().toISOString() };
  const legacyPlaces = [0, 1].map(index => ({ id: crypto.randomUUID(), userId: legacyUser.id, name: `Legacy place ${index}`, category: 'test', memo: '', tags: [], visitedAt: '2026-08-03', latitude: 37, longitude: 127, collectionId: legacyCollections[index * 2].id, privacy: 'private', imageUrl: null, createdAt: `2026-01-0${index + 1}T00:00:00.000Z` }));
  const importSource = { users: [legacyUser, importUser], collections: [...legacyCollections, importCollection], places: [...legacyPlaces, importPlace] };
  const { recoveredStore, summary: recoverySummary } = recoverLegacyUser(importSource, { userIndex: 0, password: 'Legacy fixture password 123' });
  const importPlan = buildImportPlan(recoveredStore);
  const importResult = await executeImport({ pool: importPool, plan: importPlan, recoverySummary });
  if (importResult.importable.users !== 2 || importResult.importable.collections !== 4 || importResult.importable.places !== 3 || importResult.recoveredUsers !== 1 || importResult.convertedCollections !== 3 || importResult.convertedPlaces !== 2 || importResult.inferredUserTimestamps !== 1 || importResult.inferredCollectionTimestamps !== 3 || importResult.rejectedRecords !== 0) throw new Error('import execute failed: expected import and recovery summary');
  async function counts(pool) { const result = await pool.query('SELECT (SELECT COUNT(*)::int FROM users) AS users, (SELECT COUNT(*)::int FROM collections) AS collections, (SELECT COUNT(*)::int FROM places) AS places'); return result.rows[0]; }
  const firstCounts = await counts(importPool);
  if (firstCounts.users !== 2 || firstCounts.collections !== 4 || firstCounts.places !== 3) throw new Error('import execute failed: expected row counts 2,4,3');
  const importedUser = (await importPool.query('SELECT * FROM users WHERE id = $1', [importUser.id])).rows[0];
  const importedCollection = (await importPool.query('SELECT * FROM collections WHERE id = $1', [importCollection.id])).rows[0];
  const importedPlace = (await importPool.query('SELECT * FROM places WHERE id = $1', [importPlace.id])).rows[0];
  if (!importedUser || importedUser.id !== importUser.id || importedUser.password_hash !== importUser.passwordHash || importedUser.password_salt !== importUser.passwordSalt || importedUser.created_at.toISOString() !== importUser.createdAt) throw new Error('import field preservation failed: expected user fields');
  if (!importedCollection || importedCollection.id !== importCollection.id || importedCollection.owner_id !== importUser.id) throw new Error('import field preservation failed: expected collection fields');
  if (!importedPlace || importedPlace.id !== importPlace.id || importedPlace.owner_id !== importUser.id || importedPlace.memo !== '' || importedPlace.collection_id !== null || importedPlace.image_url !== null || importedPlace.visited_at !== importPlace.visitedAt || JSON.stringify(importedPlace.tags) !== JSON.stringify(importPlace.tags)) throw new Error('import field preservation failed: expected place fields');
  const importedLegacyUser = (await importPool.query('SELECT * FROM users WHERE id = $1', [legacyUser.id])).rows[0];
  if (!importedLegacyUser || importedLegacyUser.id !== legacyUser.id || importedLegacyUser.display_name !== 'Legacy fixture' || importedLegacyUser.created_at.toISOString() !== '2026-01-01T00:00:00.000Z' || !verifyPassword('Legacy fixture password 123', { passwordHash: importedLegacyUser.password_hash, passwordSalt: importedLegacyUser.password_salt })) throw new Error('legacy recovery import failed: expected recovered credentials and timestamp');
  const importedLegacyCollection = (await importPool.query('SELECT created_at FROM collections WHERE owner_id = $1 ORDER BY created_at ASC LIMIT 1', [legacyUser.id])).rows[0];
  if (!importedLegacyCollection || importedLegacyCollection.created_at.toISOString() !== '2026-01-01T00:00:00.000Z') throw new Error('legacy collection timestamp recovery failed');
  for (const [index, expected] of [[0, '2026-01-01T00:00:00.000Z'], [1, '2026-01-01T00:00:00.000Z'], [2, '2026-01-02T00:00:00.000Z']]) {
    const row = (await importPool.query('SELECT created_at FROM collections WHERE id = $1', [legacyCollections[index].id])).rows[0];
    if (!row || row.created_at.toISOString() !== expected) throw new Error(`legacy collection ${index} timestamp recovery failed`);
  }
  if ((await importPool.query('SELECT COUNT(*)::int AS count FROM collections WHERE owner_id = $1', [legacyUser.id])).rows[0].count !== 3) throw new Error('legacy collection ownership import failed: expected 3');
  if ((await importPool.query('SELECT COUNT(*)::int AS count FROM places WHERE owner_id = $1', [legacyUser.id])).rows[0].count !== 2) throw new Error('legacy place ownership import failed: expected 2');
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
