'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hashPassword, verifyPassword } = require('./auth/password');
const { recoverLegacyUser, buildImportPlan } = require('./db/import-json');

const legacyId = 'legacy-user';
const currentId = 'current-user';
const source = {
  users: [
    { id: legacyId, email: 'legacy@example.com', name: 'Legacy', createdAt: '2020-01-01T00:00:00.000Z' },
    { id: currentId, email: 'current@example.com', displayName: 'Current', ...hashPassword('Current password 123'), createdAt: '2026-01-01T00:00:00.000Z' }
  ],
  collections: [
    { id: 'legacy-c0', userId: legacyId, name: 'Old 0', privacy: 'private', createdAt: '2020-01-01T00:00:00.000Z' },
    { id: 'legacy-c1', userId: legacyId, name: 'Old 1', privacy: 'private', createdAt: '2020-01-01T00:00:00.000Z' },
    { id: 'legacy-c2', userId: legacyId, name: 'Old 2', privacy: 'private', createdAt: '2020-01-01T00:00:00.000Z' },
    { id: 'current-c3', ownerId: currentId, name: 'Current collection', privacy: 'private', createdAt: '2026-01-01T00:00:00.000Z' }
  ],
  places: [
    { id: 'legacy-p1', userId: legacyId, name: 'Old place 1', category: 'old', collectionId: 'legacy-c0', latitude: 1, longitude: 2, privacy: 'private', createdAt: '2020-01-01T00:00:00.000Z' },
    { id: 'legacy-p2', userId: legacyId, name: 'Old place 2', category: 'old', collectionId: 'legacy-c2', latitude: 1, longitude: 2, privacy: 'private', createdAt: '2020-01-01T00:00:00.000Z' },
    { id: 'current-p0', ownerId: currentId, name: 'Current place', category: 'current', collectionId: 'current-c3', latitude: 1, longitude: 2, privacy: 'private', createdAt: '2026-01-01T00:00:00.000Z' }
  ]
};

const before = JSON.stringify(source);
const { recoveredStore, summary } = recoverLegacyUser(source, { userIndex: 0, password: 'Legacy password 123' });
assert.equal(JSON.stringify(source), before);
assert.equal(recoveredStore.users[0].id, legacyId);
assert.equal(recoveredStore.users[0].displayName, 'Legacy');
assert.equal('name' in recoveredStore.users[0], false);
assert.equal(verifyPassword('Legacy password 123', recoveredStore.users[0]), true);
assert.equal(verifyPassword('wrong password', recoveredStore.users[0]), false);
assert.equal(summary.recoveredUsers, 1);
assert.equal(summary.convertedCollections, 3);
assert.equal(summary.convertedPlaces, 2);
assert.deepEqual(buildImportPlan(recoveredStore).importable.users.map(item => item.id).sort(), [legacyId, currentId].sort());
assert.equal(buildImportPlan(recoveredStore).importable.collections.length, 4);
assert.equal(buildImportPlan(recoveredStore).importable.places.length, 3);

for (const bad of [undefined, 'short', 'x'.repeat(129)]) {
  assert.throws(() => recoverLegacyUser(source, { userIndex: 0, password: bad }));
}
assert.throws(() => recoverLegacyUser(source, { userIndex: 1, password: 'Valid password 123' }));
assert.throws(() => recoverLegacyUser(source, { userIndex: 9, password: 'Valid password 123' }));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yyj-recovery-'));
const fixturePath = path.join(tempDir, 'fixture.json');
fs.writeFileSync(fixturePath, JSON.stringify(source));
const cli = args => spawnSync(process.execPath, ['server/db/import-json.js', ...args], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, LEGACY_RECOVERY_PASSWORD: 'Legacy password 123' } });
let result = cli(['--dry-run', '--recover-user-index', '0', '--file', fixturePath]);
assert.equal(result.status, 0);
assert.deepEqual(JSON.parse(result.stdout), { source: { users: 2, collections: 4, places: 3 }, importable: { users: 2, collections: 4, places: 3 }, excluded: { users: 0, collections: 0, places: 0 }, excludedReasons: {} });
for (const args of [
  ['--dry-run', '--recover-user-index'],
  ['--dry-run', '--recover-user-index', 'x'],
  ['--dry-run', '--recover-user-index', '9'],
  ['--dry-run', '--recover-user-index', '1'],
  ['--dry-run', '--recover-user-index', '0', '--password', 'secret123'],
  ['--dry-run', '--recover-user-index', '0', '--unknown']
]) {
  result = cli([...args, '--file', fixturePath]);
  assert.notEqual(result.status, 0);
  assert.equal(`${result.stdout}${result.stderr}`.includes('Legacy password 123'), false);
}
result = spawnSync(process.execPath, ['server/db/import-json.js', '--dry-run', '--recover-user-index', '0', '--file', fixturePath], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, LEGACY_RECOVERY_PASSWORD: '' } });
assert.notEqual(result.status, 0);
result = cli(['--dry-run', '--execute', '--file', fixturePath]);
assert.notEqual(result.status, 0);
assert.equal(`${result.stdout}${result.stderr}`.includes('Legacy password 123'), false);
fs.rmSync(tempDir, { recursive: true, force: true });

console.log('Legacy recovery tests passed: copy-on-write, password verification, ownership conversion, and validation');
