'use strict';
function invalid() { const error = new Error('Public Supabase configuration is invalid'); error.code = 'PUBLIC_SUPABASE_CONFIG_ERROR'; return error; }
function resolvePublicSupabaseConfig(env = process.env) {
  const rawOtp = env.SUPABASE_EMAIL_OTP_ENABLED;
  const rawGoogle = env.SUPABASE_GOOGLE_OAUTH_ENABLED;
  let emailOtpEnabled = false;
  let googleOAuthEnabled = false;
  if (rawOtp !== undefined) {
    if (typeof rawOtp !== 'string' || !['true', 'false'].includes(rawOtp)) throw invalid();
    emailOtpEnabled = rawOtp === 'true';
  }
  if (rawGoogle !== undefined) {
    if (typeof rawGoogle !== 'string' || !['true', 'false'].includes(rawGoogle)) throw invalid();
    googleOAuthEnabled = rawGoogle === 'true';
  }
  const rawKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (rawKey === undefined || rawKey === null) {
    if (emailOtpEnabled || googleOAuthEnabled) throw invalid();
    return { enabled: false, emailOtpEnabled: false, googleOAuthEnabled: false };
  }
  if (typeof rawKey !== 'string') throw invalid();
  const key = rawKey.trim();
  if (!key) throw invalid();
  if (key.length > 2048 || key.startsWith('sb_secret_') || key.includes('.') || /\s/.test(key) || !key.startsWith('sb_publishable_')) throw invalid();
  if (typeof env.SUPABASE_URL !== 'string' || !env.SUPABASE_URL.trim()) throw invalid();
  let parsed; try { parsed = new URL(env.SUPABASE_URL.trim()); } catch { throw invalid(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '' && parsed.pathname !== '/')) throw invalid();
  return { enabled: true, emailOtpEnabled, googleOAuthEnabled, supabaseUrl: parsed.toString().replace(/\/$/, ''), publishableKey: key };
}
module.exports = { resolvePublicSupabaseConfig };
