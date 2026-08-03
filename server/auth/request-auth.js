'use strict';

const crypto = require('node:crypto');

function parseAuthorizationHeader(header) {
  if (header === undefined) return null;
  if (typeof header !== 'string' || !/^Bearer [^\s,]+$/.test(header) || header.length > 16384) { const error = new Error('Invalid authorization header'); error.code = 'INVALID_AUTHORIZATION'; throw error; }
  return header.slice(7);
}

function parseCookie(header = '') { const item = header.split(';').map(value => value.trim()).find(value => value.startsWith('yyj_session=')); if (!item) return null; try { return decodeURIComponent(item.slice(12)); } catch (_) { return null; } }

async function getLegacySessionUser({ req, storage }) {
  const token = parseCookie(req.headers.cookie);
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const session = await storage.findSessionByTokenHash(hash);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) { await storage.deleteSession(hash); return null; }
  const user = await storage.findUserById(session.userId);
  if (!user || !user.passwordHash || !user.passwordSalt) { await storage.deleteSession(hash); return null; }
  return { user, method: 'yyj_session' };
}

async function resolveRequestAuthentication({ req, storage, jwtVerifier }) {
  const token = parseAuthorizationHeader(req.headers.authorization);
  if (token) {
    if (!jwtVerifier) { const error = new Error('JWT authentication unavailable'); error.code = 'JWT_AUTH_UNAVAILABLE'; throw error; }
    let claims; try { claims = await jwtVerifier(token); } catch (_) { const error = new Error('Invalid token'); error.code = 'INVALID_TOKEN'; throw error; }
    if (typeof storage.findUserByAuthUserId !== 'function') { const error = new Error('Auth storage is not configured'); error.code = 'AUTH_CONFIGURATION_ERROR'; throw error; }
    const user = await storage.findUserByAuthUserId(claims.authUserId);
    if (!user) { const error = new Error('Auth user is not linked'); error.code = 'AUTH_USER_NOT_LINKED'; throw error; }
    const legacy = await getLegacySessionUser({ req, storage });
    if (legacy && legacy.user.id !== user.id) { const error = new Error('Authentication identity conflict'); error.code = 'AUTH_IDENTITY_CONFLICT'; throw error; }
    return { user, method: 'supabase_jwt' };
  }
  return getLegacySessionUser({ req, storage });
}

module.exports = { parseAuthorizationHeader, getLegacySessionUser, resolveRequestAuthentication };
