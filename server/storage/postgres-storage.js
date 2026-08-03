'use strict';

function toUser(row) { return row && { id: row.id, email: row.email, displayName: row.display_name, passwordSalt: row.password_salt, passwordHash: row.password_hash, createdAt: new Date(row.created_at).toISOString() }; }
function toCollection(row) { return row && { id: row.id, ownerId: row.owner_id, name: row.name, privacy: row.privacy, shareToken: row.share_token, createdAt: new Date(row.created_at).toISOString() }; }
function toPlace(row) { return row && { id: row.id, ownerId: row.owner_id, name: row.name, category: row.category, memo: row.memo, tags: row.tags || [], visitedAt: row.visited_at, latitude: Number(row.latitude), longitude: Number(row.longitude), collectionId: row.collection_id, privacy: row.privacy, imageUrl: row.image_url, createdAt: new Date(row.created_at).toISOString() }; }

function createPostgresStorage({ pool }) {
  if (!pool) throw new Error('PostgreSQL pool is required');
  const query = (text, values) => pool.query(text, values);
  return {
    async initialize() { const result = await query("SELECT to_regclass('users') AS users, to_regclass('collections') AS collections, to_regclass('places') AS places, to_regclass('sessions') AS sessions"); if (!result.rows[0].users || !result.rows[0].collections || !result.rows[0].places || !result.rows[0].sessions) throw new Error('PostgreSQL schema is not migrated'); await query('DELETE FROM sessions WHERE expires_at <= now()'); },
    async findUserById(id) { const row = (await query('SELECT * FROM users WHERE id = $1', [id])).rows[0]; return row ? toUser(row) : null; },
    async findUserByEmail(email) { const row = (await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email])).rows[0]; return row ? toUser(row) : null; },
    async createUser(user) { try { const row = (await query('INSERT INTO users(id,email,display_name,password_salt,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [user.id,user.email,user.displayName,user.passwordSalt,user.passwordHash,user.createdAt])).rows[0]; return toUser(row); } catch (error) { if (error.code === '23505') { error.code = 'EMAIL_EXISTS'; } throw error; } },
    async listCollections(ownerId) { return (await query('SELECT * FROM collections WHERE owner_id = $1 ORDER BY created_at', [ownerId])).rows.map(toCollection); },
    async findCollectionById(ownerId, id) { const row = (await query('SELECT * FROM collections WHERE owner_id = $1 AND id = $2', [ownerId,id])).rows[0]; return row ? toCollection(row) : null; },
    async createCollection(item) { return toCollection((await query('INSERT INTO collections(id,owner_id,name,privacy,share_token,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [item.id,item.ownerId,item.name,item.privacy,item.shareToken,item.createdAt])).rows[0]); },
    async listPlaces(ownerId) { return (await query('SELECT * FROM places WHERE owner_id = $1 ORDER BY created_at DESC', [ownerId])).rows.map(toPlace); },
    async findPlaceById(ownerId, id) { const row = (await query('SELECT * FROM places WHERE owner_id = $1 AND id = $2', [ownerId,id])).rows[0]; return row ? toPlace(row) : null; },
    async createPlace(item) { return toPlace((await query('INSERT INTO places(id,owner_id,name,category,memo,tags,visited_at,latitude,longitude,collection_id,privacy,image_url,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *', [item.id,item.ownerId,item.name,item.category,item.memo,item.tags,item.visitedAt,item.latitude,item.longitude,item.collectionId,item.privacy,item.imageUrl,item.createdAt])).rows[0]); },
    async updatePlace(ownerId, id, item) { const row = (await query('UPDATE places SET name=$1,category=$2,memo=$3,tags=$4,visited_at=$5,latitude=$6,longitude=$7,collection_id=$8,privacy=$9,image_url=$10 WHERE owner_id=$11 AND id=$12 RETURNING *', [item.name,item.category,item.memo,item.tags,item.visitedAt,item.latitude,item.longitude,item.collectionId,item.privacy,item.imageUrl,ownerId,id])).rows[0]; return row ? toPlace(row) : null; },
    async deletePlace(ownerId, id) { return (await query('DELETE FROM places WHERE owner_id=$1 AND id=$2', [ownerId,id])).rowCount === 1; },
    async createSession(session) { const row = (await query('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES($1,$2,$3,$4) RETURNING *', [session.tokenHash, session.userId, session.createdAt, session.expiresAt])).rows[0]; return { tokenHash: row.token_hash, userId: row.user_id, createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() }; },
    async findSessionByTokenHash(tokenHash) { const row = (await query('SELECT * FROM sessions WHERE token_hash=$1', [tokenHash])).rows[0]; return row ? { tokenHash: row.token_hash, userId: row.user_id, createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() } : null; },
    async deleteSession(tokenHash) { return (await query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash])).rowCount === 1; },
    async deleteExpiredSessions(now) { return (await query('DELETE FROM sessions WHERE expires_at <= $1', [now])).rowCount; }
  };
}
module.exports = { createPostgresStorage, toUser, toCollection, toPlace };
