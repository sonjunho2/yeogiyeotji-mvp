'use strict';
const assert = require('node:assert/strict');
const { resolvePublicSupabaseConfig } = require('./auth/public-supabase-config');
assert.deepEqual(resolvePublicSupabaseConfig({}), { enabled: false });
assert.deepEqual(resolvePublicSupabaseConfig({ SUPABASE_URL: 'https://project.supabase.co' }), { enabled: false });
assert.equal(resolvePublicSupabaseConfig({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }).enabled, true);
assert.deepEqual(resolvePublicSupabaseConfig({ SUPABASE_URL: 'https://project.supabase.co/', SUPABASE_PUBLISHABLE_KEY: '  sb_publishable_test  ' }), { enabled: true, supabaseUrl: 'https://project.supabase.co', publishableKey: 'sb_publishable_test' });
for (const env of [
  { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: '' },
  { SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: '   ' },
  { SUPABASE_URL: 123, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb publishable' },
  { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 123 },
  { SUPABASE_URL: 'http://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  { SUPABASE_URL: 'https://project.supabase.co/path', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  { SUPABASE_URL: 'https://user:pass@project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  { SUPABASE_URL: 'https://project.supabase.co?x=1', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  { SUPABASE_URL: 'https://project.supabase.co#x', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test' },
  { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'eyJ.test' },
  { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'x'.repeat(2048)}` }
]) assert.throws(() => resolvePublicSupabaseConfig(env), { code: 'PUBLIC_SUPABASE_CONFIG_ERROR', message: 'Public Supabase configuration is invalid' });
console.log('public Supabase config tests passed');
