'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('./pool');

function parseArgs(argv) {
  const fileIndex = argv.indexOf('--file');
  const modes = ['--dry-run', '--execute'].filter(flag => argv.includes(flag));
  if (modes.length !== 1) throw new Error('Use exactly one of --dry-run or --execute');
  if (fileIndex >= 0 && (!argv[fileIndex + 1] || argv[fileIndex + 1].startsWith('--'))) throw new Error('--file requires a path');
  return { mode: modes[0].slice(2), file: fileIndex >= 0 ? argv[fileIndex + 1] : path.join(__dirname, '..', 'data', 'store.json') };
}

async function readImportSource(filePath) {
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  for (const key of ['users', 'collections', 'places']) if (!Array.isArray(raw[key])) throw new Error(`${key} must be an array`);
  return raw;
}

function buildImportPlan(source) {
  const plan = { source: { users: source.users.length, collections: source.collections.length, places: source.places.length }, importable: { users: [], collections: [], places: [] }, excluded: { users: [], collections: [], places: [] }, excludedReasons: {} };
  const excluded = (kind, reason, item) => { plan.excluded[kind].push(item); plan.excludedReasons[`${kind}.${reason}`] = (plan.excludedReasons[`${kind}.${reason}`] || 0) + 1; };
  const usersById = new Map();
  const emails = new Set();
  for (const user of source.users) {
    const valid = user && user.id && user.email && user.displayName && user.passwordHash && user.passwordSalt && user.createdAt;
    const email = valid ? String(user.email).trim().toLowerCase() : null;
    if (!valid) excluded('users', 'invalid', user);
    else if (usersById.has(user.id)) excluded('users', 'duplicate_id', user);
    else if (emails.has(email)) excluded('users', 'duplicate_email', user);
    else { const normalized = { ...user, email }; usersById.set(user.id, normalized); emails.add(email); plan.importable.users.push(normalized); }
  }
  const collectionsById = new Map();
  for (const collection of source.collections) {
    const valid = collection && collection.id && collection.ownerId && usersById.has(collection.ownerId) && collection.name && ['private', 'link'].includes(collection.privacy) && collection.createdAt;
    if (!valid) { excluded('collections', 'invalid_or_missing_owner', collection); continue; }
    if (collectionsById.has(collection.id)) { excluded('collections', 'duplicate_id', collection); continue; }
    const normalized = { ...collection }; collectionsById.set(collection.id, normalized); plan.importable.collections.push(normalized);
  }
  for (const place of source.places) {
    const validCoordinates = Number.isFinite(Number(place && place.latitude)) && Number(place.latitude) >= -90 && Number(place.latitude) <= 90 && Number.isFinite(Number(place.longitude)) && Number(place.longitude) >= -180 && Number(place.longitude) <= 180;
    const valid = place && place.id && place.ownerId && usersById.has(place.ownerId) && place.name && place.category && place.createdAt && validCoordinates && ['private', 'link', 'public'].includes(place.privacy || 'private');
    if (!valid) { excluded('places', 'invalid_or_missing_owner', place); continue; }
    if (place.collectionId && (!collectionsById.has(place.collectionId) || collectionsById.get(place.collectionId).ownerId !== place.ownerId)) { excluded('places', 'invalid_collection_owner', place); continue; }
    if (plan.importable.places.some(item => item.id === place.id)) { excluded('places', 'duplicate_id', place); continue; }
    plan.importable.places.push({ ...place, memo: String(place.memo || ''), tags: Array.isArray(place.tags) ? place.tags.map(String) : [], visitedAt: place.visitedAt || new Date().toISOString().slice(0, 10), privacy: place.privacy || 'private', imageUrl: place.imageUrl || null, collectionId: place.collectionId || null });
  }
  return plan;
}

function summary(plan) {
  return { source: plan.source, importable: Object.fromEntries(Object.entries(plan.importable).map(([key, items]) => [key, items.length])), excluded: Object.fromEntries(Object.entries(plan.excluded).map(([key, items]) => [key, items.length])), excludedReasons: plan.excludedReasons };
}

async function executeImport({ pool, plan }) {
  if (!pool) throw new Error('PostgreSQL pool is required for execute');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of ['users', 'collections', 'places']) {
      const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      if (result.rows[0].count !== 0) throw new Error(`Import requires empty ${table} table`);
    }
    for (const user of plan.importable.users) await client.query('INSERT INTO users(id,email,display_name,password_salt,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6)', [user.id,user.email,user.displayName,user.passwordSalt,user.passwordHash,user.createdAt]);
    for (const item of plan.importable.collections) await client.query('INSERT INTO collections(id,owner_id,name,privacy,share_token,created_at) VALUES($1,$2,$3,$4,$5,$6)', [item.id,item.ownerId,item.name,item.privacy,item.shareToken || null,item.createdAt]);
    for (const item of plan.importable.places) await client.query('INSERT INTO places(id,owner_id,name,category,memo,tags,visited_at,latitude,longitude,collection_id,privacy,image_url,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [item.id,item.ownerId,item.name,item.category,item.memo,item.tags,item.visitedAt,item.latitude,item.longitude,item.collectionId,item.privacy,item.imageUrl,item.createdAt]);
    await client.query('COMMIT');
    return summary(plan);
  } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const plan = buildImportPlan(await readImportSource(args.file));
  if (args.mode === 'dry-run') return summary(plan);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for --execute');
  const pool = createPool({ connectionString: env.DATABASE_URL });
  try { return await executeImport({ pool, plan }); } finally { await pool.end(); }
}

if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseArgs, readImportSource, buildImportPlan, executeImport, main };
