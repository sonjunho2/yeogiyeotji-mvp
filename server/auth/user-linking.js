'use strict';

const { parseAuthorizationHeader, getLegacySessionUser } = require('./request-auth');
const { verifyPassword } = require('./password');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function linkSupabaseUser({ req, storage, jwtVerifier, password }) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 128) {
    throw createError('VALIDATION_ERROR', 'Invalid password');
  }

  const legacy = await getLegacySessionUser({ req, storage });
  if (!legacy) throw createError('LEGACY_SESSION_REQUIRED', 'Legacy session required');
  if (!verifyPassword(password, legacy.user)) throw createError('REAUTHENTICATION_FAILED', 'Reauthentication failed');

  const token = parseAuthorizationHeader(req.headers.authorization);
  if (!token) throw createError('BEARER_REQUIRED', 'Bearer token required');
  if (typeof jwtVerifier !== 'function') throw createError('JWT_AUTH_UNAVAILABLE', 'JWT authentication unavailable');

  let claims;
  try { claims = await jwtVerifier(token); } catch (_) { throw createError('INVALID_TOKEN', 'Invalid token'); }
  if (!claims || typeof claims.authUserId !== 'string' || !UUID.test(claims.authUserId)) throw createError('INVALID_TOKEN', 'Invalid token');
  if (typeof storage.linkUserToAuthUser !== 'function') throw createError('AUTH_CONFIGURATION_ERROR', 'Auth storage is not configured');

  const wasAlreadyLinked = legacy.user.authUserId === claims.authUserId;
  let linkedUser;
  try {
    linkedUser = await storage.linkUserToAuthUser(legacy.user.id, claims.authUserId);
  } catch (error) {
    if (error.code === 'AUTH_USER_EXISTS' || error.code === 'USER_AUTH_ALREADY_LINKED') throw createError('AUTH_LINK_CONFLICT', 'Auth link conflict');
    throw error;
  }
  if (!linkedUser) throw createError('LEGACY_SESSION_REQUIRED', 'Legacy session required');

  return {
    item: { id: linkedUser.id, email: linkedUser.email, displayName: linkedUser.displayName, linked: true },
    idempotent: wasAlreadyLinked
  };
}

module.exports = { linkSupabaseUser };
