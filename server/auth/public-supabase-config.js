'use strict';
function invalid() { const error = new Error('Public Supabase configuration is invalid'); error.code = 'PUBLIC_SUPABASE_CONFIG_ERROR'; return error; }
function resolvePublicSupabaseConfig(env = process.env) {
  const rawKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (rawKey === undefined || rawKey === null) return { enabled: false };
  if (typeof rawKey !== 'string') throw invalid();
  const key = rawKey.trim();
  if (!key) throw invalid();
  if (key.length > 2048 || key.startsWith('sb_secret_') || key.includes('.') || /\s/.test(key) || !key.startsWith('sb_publishable_')) throw invalid();
  if (typeof env.SUPABASE_URL !== 'string' || !env.SUPABASE_URL.trim()) throw invalid();
  let parsed; try { parsed = new URL(env.SUPABASE_URL.trim()); } catch { throw invalid(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '' && parsed.pathname !== '/')) throw invalid();
  return { enabled: true, supabaseUrl: parsed.toString().replace(/\/$/, ''), publishableKey: key };
}
module.exports = { resolvePublicSupabaseConfig };
