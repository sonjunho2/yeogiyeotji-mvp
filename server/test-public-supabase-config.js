'use strict';
const assert = require('node:assert/strict');
const { resolvePublicSupabaseConfig } = require('./auth/public-supabase-config');

const errorCode = 'PUBLIC_SUPABASE_CONFIG_ERROR';
const errorMessage = 'Public Supabase configuration is invalid';
function assertConfigError(env, hiddenValues = Object.values(env).filter(value => typeof value === 'string' && value)) {
  assert.throws(() => resolvePublicSupabaseConfig(env), error => {
    assert.equal(error.code, errorCode);
    assert.equal(error.message, errorMessage);
    const serialized = JSON.stringify(error);
    for (const value of hiddenValues) assert.equal(serialized.includes(value), false);
    assert.equal(serialized.includes('SUPABASE_URL'), false);
    assert.equal(serialized.includes('SUPABASE_PUBLISHABLE_KEY'), false);
    assert.equal(serialized.includes('SUPABASE_EMAIL_OTP_ENABLED'), false);
    assert.equal(serialized.includes('stack'), false);
    return true;
  });
}

function testDisabledConfigurations() {
  assert.deepEqual(resolvePublicSupabaseConfig({}), { enabled: false, emailOtpEnabled: false });
  assert.deepEqual(resolvePublicSupabaseConfig({ SUPABASE_EMAIL_OTP_ENABLED: 'false' }), { enabled: false, emailOtpEnabled: false });
  assert.deepEqual(resolvePublicSupabaseConfig({ SUPABASE_URL: 'https://project.supabase.co' }), { enabled: false, emailOtpEnabled: false });
  assert.deepEqual(resolvePublicSupabaseConfig({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_EMAIL_OTP_ENABLED: 'false' }), { enabled: false, emailOtpEnabled: false });
}

function testEnabledConfigurations() {
  const normal = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
  assert.deepEqual(resolvePublicSupabaseConfig(normal), { enabled: true, emailOtpEnabled: false, supabaseUrl: normal.SUPABASE_URL, publishableKey: normal.SUPABASE_PUBLISHABLE_KEY });
  assert.equal(resolvePublicSupabaseConfig({ ...normal, SUPABASE_EMAIL_OTP_ENABLED: 'false' }).emailOtpEnabled, false);
  assert.equal(resolvePublicSupabaseConfig({ ...normal, SUPABASE_EMAIL_OTP_ENABLED: 'true' }).emailOtpEnabled, true);
  const padded = { SUPABASE_URL: 'https://project.supabase.co/', SUPABASE_PUBLISHABLE_KEY: '  sb_publishable_test  ', SUPABASE_EMAIL_OTP_ENABLED: 'true' };
  const before = { ...padded }; assert.deepEqual(resolvePublicSupabaseConfig(padded), { enabled: true, emailOtpEnabled: true, supabaseUrl: 'https://project.supabase.co', publishableKey: 'sb_publishable_test' }); assert.deepEqual(padded, before);
}

function testOtpFlagValidation() {
  for (const value of ['', ' ', 'true ', ' true', ' true ', 'false ', ' false', ' false ', 'TRUE', 'FALSE', 'True', 'False', '1', '0', 'yes', 'no', 1, 0, true, false, null, {}, [], () => {}]) assertConfigError({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_EMAIL_OTP_ENABLED: value });
}

function testOtpDependencyValidation() {
  assertConfigError({ SUPABASE_EMAIL_OTP_ENABLED: 'true' });
  assertConfigError({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_EMAIL_OTP_ENABLED: 'true' });
  assertConfigError({ SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_EMAIL_OTP_ENABLED: 'true' });
  assertConfigError({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_EMAIL_OTP_ENABLED: 'true' });
  assertConfigError({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: '   ', SUPABASE_EMAIL_OTP_ENABLED: 'true' });
}

function testExistingUrlAndKeyValidation() {
  for (const url of ['http://project.supabase.co', 'ftp://project.supabase.co', 'https://user:pass@project.supabase.co', 'https://project.supabase.co/path', 'https://project.supabase.co?query=1', 'https://project.supabase.co#hash', 'not a url', '', '   ', 123, null, {}]) assertConfigError({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' });
  for (const key of ['', '   ', 'sb_secret_test', 'eyJ.test', 'publishable_test', 123, true, {}, [], `sb_publishable_${'x'.repeat(2048)}`, 'sb_publishable_with space']) assertConfigError({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: key });
}

function run() {
  testDisabledConfigurations();
  testEnabledConfigurations();
  testOtpFlagValidation();
  testOtpDependencyValidation();
  testExistingUrlAndKeyValidation();
  console.log('public Supabase config tests passed: disabled/enabled states, OTP flags, dependencies, URL/key validation, and safe errors');
}
run();
