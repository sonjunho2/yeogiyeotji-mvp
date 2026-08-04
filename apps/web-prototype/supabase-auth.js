(function () {
  'use strict';
  let client = null;
  let enabled = false;
  let accessToken = null;
  let clientUrl = null;
  let clientKey = null;
  let signedOut = false;
  let emailOtpEnabled = false;
  function authError() { const error = new Error('Supabase authentication state could not be read'); error.code = 'SUPABASE_AUTH_STATE_ERROR'; return error; }
  function configError() { const error = new Error('Supabase authentication configuration is invalid'); error.code = 'SUPABASE_AUTH_CONFIG_ERROR'; return error; }
  function initialize(config) {
    const nextEnabled = !!(config && config.enabled);
    if (!nextEnabled) { enabled = false; emailOtpEnabled = false; accessToken = null; signedOut = false; return; }
    if (typeof config.supabaseUrl !== 'string' || !config.supabaseUrl.trim()) throw configError();
    const normalizedUrl = config.supabaseUrl.trim();
    let parsed; try { parsed = new URL(normalizedUrl); } catch { throw configError(); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '' && parsed.pathname !== '/') || typeof config.publishableKey !== 'string' || !config.publishableKey.startsWith('sb_publishable_')) throw configError();
    if (!window.supabase || typeof window.supabase.createClient !== 'function') { client = null; enabled = false; accessToken = null; return; }
    if (normalizedUrl.replace(/\/$/, '') !== parsed.toString().replace(/\/$/, '')) throw configError();
    if (client && (clientUrl !== parsed.toString().replace(/\/$/, '') || clientKey !== config.publishableKey)) throw configError();
    if (client && clientUrl === parsed.toString().replace(/\/$/, '') && clientKey === config.publishableKey) { enabled = true; emailOtpEnabled = config.emailOtpEnabled === true; return; }
    try { client = window.supabase.createClient(parsed.toString().replace(/\/$/, ''), config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); } catch { client = null; enabled = false; throw configError(); }
    clientUrl = parsed.toString().replace(/\/$/, ''); clientKey = config.publishableKey; enabled = true; emailOtpEnabled = config.emailOtpEnabled === true; accessToken = null; signedOut = false;
    client.auth.onAuthStateChange((event, session) => { if (['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'SIGNED_OUT'].includes(event)) { signedOut = event === 'SIGNED_OUT'; accessToken = signedOut ? null : (session && session.access_token ? session.access_token : null); } });
  }
  async function getAccessToken() {
    if (!enabled || !client) return null;
    if (accessToken) return accessToken;
    if (signedOut) return null;
    let result;
    try { result = await client.auth.getSession(); } catch { throw authError(); }
    if (result && result.error) throw authError();
    accessToken = result && result.data && result.data.session ? result.data.session.access_token : null;
    return accessToken;
  }
  async function signOut() {
    if (!enabled || !client) return;
    let result; try { result = await client.auth.signOut(); } catch { throw authError(); }
    if (result && result.error) throw authError();
    accessToken = null; signedOut = true;
  }
  function otpError(code, message) { const error = new Error(message); error.code = code; return error; }
  function normalizeEmail(email) { if (typeof email !== 'string') return null; const value = email.trim().toLowerCase(); return value && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null; }
  function ensureOtp() { if (!enabled || !emailOtpEnabled || !client) throw otpError('SUPABASE_EMAIL_OTP_UNAVAILABLE', '이메일 인증 로그인을 사용할 수 없습니다.'); }
  async function requestEmailOtp(email) {
    ensureOtp(); const normalizedEmail = normalizeEmail(email); if (!normalizedEmail) throw otpError('SUPABASE_EMAIL_OTP_INPUT_ERROR', '이메일 또는 인증 코드를 확인해 주세요.');
    try { const result = await client.auth.signInWithOtp({ email: normalizedEmail, options: { shouldCreateUser: false } }); if (result && result.error) throw result.error; return { sent: true, email: normalizedEmail }; } catch { throw otpError('SUPABASE_EMAIL_OTP_SEND_ERROR', '인증 코드를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  }
  async function verifyEmailOtp(email, token) {
    ensureOtp(); const normalizedEmail = normalizeEmail(email); const normalizedToken = typeof token === 'string' ? token : ''; if (!normalizedEmail || !/^\d{6}$/.test(normalizedToken)) throw otpError('SUPABASE_EMAIL_OTP_INPUT_ERROR', '이메일 또는 인증 코드를 확인해 주세요.');
    let result; try { result = await client.auth.verifyOtp({ email: normalizedEmail, token: normalizedToken, type: 'email' }); } catch { throw otpError('SUPABASE_EMAIL_OTP_VERIFY_ERROR', '인증 코드가 올바르지 않거나 만료되었습니다.'); }
    const verifiedAccessToken = result && result.data && result.data.session && result.data.session.access_token;
    if (result && result.error || typeof verifiedAccessToken !== 'string' || !verifiedAccessToken) throw otpError('SUPABASE_EMAIL_OTP_VERIFY_ERROR', '인증 코드가 올바르지 않거나 만료되었습니다.');
    accessToken = verifiedAccessToken; signedOut = false; return { verified: true, email: normalizedEmail };
  }
  window.YYJSupabaseAuth = { initialize, getAccessToken, signOut, isEnabled: () => enabled, isEmailOtpEnabled: () => enabled && emailOtpEnabled, requestEmailOtp, verifyEmailOtp };
})();
