'use strict';

const { linkSupabaseUser } = require('./user-linking');

const PUBLIC_ERRORS = {
  VALIDATION_ERROR: [400, 'validation_error', '요청 형식이 올바르지 않습니다.'],
  LEGACY_SESSION_REQUIRED: [401, 'legacy_session_required', '로그인이 필요합니다.'],
  REAUTHENTICATION_FAILED: [401, 'reauthentication_failed', '비밀번호를 확인해 주세요.'],
  BEARER_REQUIRED: [401, 'bearer_required', '인증을 확인할 수 없습니다.'],
  INVALID_AUTHORIZATION: [401, 'invalid_authorization', '인증을 확인할 수 없습니다.'],
  INVALID_TOKEN: [401, 'invalid_token', '인증을 확인할 수 없습니다.'],
  AUTH_LINK_CONFLICT: [409, 'auth_link_conflict', '계정을 연결할 수 없습니다.'],
  JWT_AUTH_UNAVAILABLE: [503, 'auth_link_unavailable', '인증 연결을 사용할 수 없습니다.'],
  AUTH_CONFIGURATION_ERROR: [503, 'auth_link_unavailable', '인증 연결을 사용할 수 없습니다.']
};

async function resolveSupabaseUserLinkResponse({ req, url, storage, jwtVerifier, readBody }) {
  if (!req.headers || typeof req.headers.origin !== 'string' || req.headers.origin !== url.origin) {
    return { status: 403, payload: { error: 'invalid_origin', message: '허용되지 않은 요청 출처입니다.' } };
  }
  const body = await readBody(req);
  const password = body && !Array.isArray(body) && typeof body === 'object' ? body.password : undefined;
  try {
    const result = await linkSupabaseUser({ req, storage, jwtVerifier, password });
    return { status: 200, payload: result };
  } catch (error) {
    const mapped = PUBLIC_ERRORS[error && error.code];
    if (mapped) return { status: mapped[0], payload: { error: mapped[1], message: mapped[2] } };
    throw error;
  }
}

module.exports = { resolveSupabaseUserLinkResponse };
