(function () {
  'use strict';
  let client = null;
  let enabled = false;
  let accessToken = null;
  let clientUrl = null;
  let clientKey = null;
  let signedOut = false;
  function authError() { const error = new Error('Supabase authentication state could not be read'); error.code = 'SUPABASE_AUTH_STATE_ERROR'; return error; }
  function configError() { const error = new Error('Supabase authentication configuration is invalid'); error.code = 'SUPABASE_AUTH_CONFIG_ERROR'; return error; }
  function initialize(config) {
    const nextEnabled = !!(config && config.enabled);
    if (!nextEnabled) { enabled = false; accessToken = null; signedOut = false; return; }
    if (typeof config.supabaseUrl !== 'string' || !config.supabaseUrl.trim()) throw configError();
    const normalizedUrl = config.supabaseUrl.trim();
    let parsed; try { parsed = new URL(normalizedUrl); } catch { throw configError(); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '' && parsed.pathname !== '/') || typeof config.publishableKey !== 'string' || !config.publishableKey.startsWith('sb_publishable_')) throw configError();
    if (!window.supabase || typeof window.supabase.createClient !== 'function') { client = null; enabled = false; accessToken = null; return; }
    if (normalizedUrl.replace(/\/$/, '') !== parsed.toString().replace(/\/$/, '')) throw configError();
    if (client && (clientUrl !== parsed.toString().replace(/\/$/, '') || clientKey !== config.publishableKey)) throw configError();
    if (client && clientUrl === parsed.toString().replace(/\/$/, '') && clientKey === config.publishableKey) { enabled = true; return; }
    try { client = window.supabase.createClient(parsed.toString().replace(/\/$/, ''), config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); } catch { client = null; enabled = false; throw configError(); }
    clientUrl = parsed.toString().replace(/\/$/, ''); clientKey = config.publishableKey; enabled = true; accessToken = null; signedOut = false;
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
  window.YYJSupabaseAuth = { initialize, getAccessToken, signOut, isEnabled: () => enabled };
})();
