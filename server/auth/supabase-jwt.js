'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT_ERROR_CODE = 'INVALID_SUPABASE_JWT';

function configError() {
  const error = new Error('Supabase JWT configuration is invalid');
  error.code = 'SUPABASE_JWT_CONFIG_ERROR';
  return error;
}

function parseUrl(value, allowInsecureHttp) {
  const url = new URL(value);
  if ((!allowInsecureHttp && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw configError();
  return url;
}

function resolveSupabaseJwtConfig(env = process.env, { allowInsecureHttp = false } = {}) {
  const hasAny = ['SUPABASE_URL', 'SUPABASE_JWT_ISSUER', 'SUPABASE_JWKS_URL', 'SUPABASE_JWT_AUDIENCE'].some(key => env[key] !== undefined && env[key] !== '');
  if (!env.SUPABASE_URL) { if (hasAny) throw configError(); return { enabled: false }; }
  try {
    const base = parseUrl(env.SUPABASE_URL, allowInsecureHttp);
    if (!['', '/'].includes(base.pathname)) throw configError();
    const issuer = parseUrl(env.SUPABASE_JWT_ISSUER || `${base.origin}/auth/v1`, allowInsecureHttp);
    const jwksUrl = parseUrl(env.SUPABASE_JWKS_URL || `${issuer.origin}/auth/v1/.well-known/jwks.json`, allowInsecureHttp);
    if (issuer.origin !== base.origin || jwksUrl.origin !== base.origin || issuer.pathname !== '/auth/v1' || jwksUrl.pathname !== '/auth/v1/.well-known/jwks.json') throw configError();
    const audience = env.SUPABASE_JWT_AUDIENCE === undefined ? 'authenticated' : String(env.SUPABASE_JWT_AUDIENCE).trim();
    if (!audience) throw configError();
    return { enabled: true, issuer: issuer.toString().replace(/\/$/, ''), jwksUrl: jwksUrl.toString(), audience };
  } catch (error) { if (error.code === 'SUPABASE_JWT_CONFIG_ERROR') throw error; throw configError(); }
}

async function createSupabaseJwtVerifier({ config = resolveSupabaseJwtConfig(), jwks, createRemoteJWKSetFn } = {}) {
  if (!config.enabled) return null;
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const remote = jwks || (createRemoteJWKSetFn || createRemoteJWKSet)(new URL(config.jwksUrl), { cacheMaxAge: 600000, cooldownDuration: 30000, timeoutDuration: 5000 });
  return async token => {
    try {
      const { protectedHeader, payload } = await jwtVerify(token, remote, { issuer: config.issuer, audience: config.audience, algorithms: ['ES256', 'RS256'], typ: 'JWT', clockTolerance: 5 });
      if (typeof protectedHeader.kid !== 'string' || !protectedHeader.kid.trim() || typeof payload.sub !== 'string' || !UUID.test(payload.sub) || payload.role !== 'authenticated' || payload.is_anonymous === true || typeof payload.exp !== 'number') throw new Error('claims');
      return { authUserId: payload.sub, role: payload.role, sessionId: typeof payload.session_id === 'string' ? payload.session_id : null };
    } catch (_) { const error = new Error('Invalid Supabase JWT'); error.code = JWT_ERROR_CODE; throw error; }
  };
}

module.exports = { resolveSupabaseJwtConfig, createSupabaseJwtVerifier };
