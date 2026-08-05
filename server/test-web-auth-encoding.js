'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const requiredByFile = {
  'apps/web-prototype/app.js': [
    '여기였지',
    '이메일 인증코드로 로그인',
    '전송한 이메일:',
    'Google로 로그인',
    'authViewState.notice',
    'authViewState.error'
  ],
  'apps/web-prototype/supabase-auth.js': [
    '이메일 인증 로그인을 사용할 수 없습니다.',
    'Google 로그인'
  ],
  'apps/web-prototype/auth-controller.js': [
    '인증 코드를 보냈습니다. 받은 편지함을 확인해 주세요.',
    '이 인증 계정은 아직 여기였지 계정에 연결되지 않았습니다. 기존 이메일과 비밀번호로 로그인해 주세요.',
    '현재 비밀번호 로그인과 다른 인증 계정입니다. 인증을 종료한 뒤 다시 시도해 주세요.',
    '인증을 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    'Google 로그인 화면으로 이동합니다.',
    'Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  ],
  'docs/UNIFIED_AUTH_ARCHITECTURE.md': [
    '이메일 OTP 클라이언트 기반',
    '{{ .Token }}',
    '## 5-1 Google OAuth 클라이언트 기반'
  ]
};

const forbiddenMojibake = ['?몄쬆', '?대찓', '紐삵', '?듬땲', '�', '占?'];
const requiredDocumentPolicies = [
  'SUPABASE_GOOGLE_OAUTH_ENABLED', '기본값', '정확한 `true`', '정확한 `false`',
  'signInWithOAuth()', "provider: 'google'", 'redirectTo', 'location.origin', 'location.pathname',
  'query', 'hash', 'http:', 'https:', 'file:', 'Redirect URLs', 'JWT', 'yyj_session',
  'public.users', 'auth_user_id', '401', '409', 'Kakao OAuth 미구현', 'Apple OAuth 미구현',
  '인증 종료 후 다시 시도', '후속 단계', '임의의 외부 origin', '기존 이메일/비밀번호 로그인',
  '기존 이메일 OTP 로그인', 'provider access token', 'provider refresh token', 'OAuth URL', 'token',
  '애플리케이션 반환값',
  '로그',
  '사용자 화면',
];
const forbiddenProviderText = [
  '이 이메일 인증 계정',
  '다른 이메일 인증 계정',
  '이메일 인증을 종료하지 못했습니다',
  '이메일 인증을 종료한 뒤 다시 시도해 주세요',
  '이메일 인증 종료 후 다시 시도',
  '이메일 인증이 종료되면 다시 시도'
];

for (const [file, required] of Object.entries(requiredByFile)) {
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('utf8');

  assert.equal(text.includes('\uFFFD'), false, file + ' contains replacement character');
  assert.equal(/[\u0080-\u009F]/.test(text), false, file + ' contains C1 controls');
  assert.equal(Buffer.compare(bytes, Buffer.from(text, 'utf8')), 0, file + ' failed UTF-8 round trip');

  for (const value of required) assert.ok(text.includes(value), file + ' is missing ' + value);
  for (const value of forbiddenMojibake) assert.equal(text.includes(value), false, file + ' contains forbidden mojibake: ' + value);
  for (const value of forbiddenProviderText) assert.equal(text.includes(value), false, file + ' contains forbidden provider-specific text: ' + value);
}

const controller = fs.readFileSync('apps/web-prototype/auth-controller.js', 'utf8');
assert.equal(controller.includes('if (issueText[code])'), false);

const document = fs.readFileSync('docs/UNIFIED_AUTH_ARCHITECTURE.md', 'utf8');
assert.equal(document.includes('\\n\\n## 5-1'), false);
assert.match(document, /## 5-1 Google OAuth 클라이언트 기반/);

const sectionStart = document.indexOf('## 5-1 Google OAuth 클라이언트 기반');
assert.notEqual(sectionStart, -1);
const nextHeading = document.indexOf('\n## ', sectionStart + 4);
const googleSection = nextHeading === -1 ? document.slice(sectionStart) : document.slice(sectionStart, nextHeading);
for (const policy of requiredDocumentPolicies) assert.ok(googleSection.includes(policy), 'document policy missing: ' + policy);
const policyLines = googleSection.split('\n');
const assertPolicyLine = (label, terms) => assert.ok(policyLines.some(line => terms.every(term => line.includes(term))), label);
assertPolicyLine('Client ID browser storage', ['Client ID', '브라우저 JavaScript', '저장하지 않는다']);
assertPolicyLine('Client Secret browser storage', ['Client Secret', '브라우저 JavaScript', '저장하지 않는다']);
assertPolicyLine('Client ID Git storage', ['Client ID', 'Git 저장소', '커밋하지 않는다']);
assertPolicyLine('Client Secret Git storage', ['Client Secret', 'Git 저장소', '커밋하지 않는다']);
assertPolicyLine('access token request/storage', ['access token', '직접 요청하거나 저장하지 않는다']);
assertPolicyLine('refresh token request/storage', ['refresh token', '직접 요청하거나 저장하지 않는다']);

assert.ok(/운영 Google provider 활성화[\s\S]{0,100}아직 수행하지 않았다/.test(googleSection));
const countOccurrences = (text, value) => text.split(value).length - 1;
for (const value of ['Kakao OAuth 미구현', 'Apple OAuth 미구현', '임의의 외부 origin', '서버의 명시적 사용자 연결 절차', '운영 Google provider 활성화', '실제 Google 로그인 검증']) assert.equal(countOccurrences(googleSection, value), 1, value);
assert.equal(countOccurrences(googleSection, 'Kakao OAuth와 Apple OAuth도 지원하지 않는다'), 0);
assertPolicyLine(
  'OAuth URL and token exposure',
  [
    'OAuth URL',
    'token',
    '사용자 화면',
    '로그',
    '애플리케이션 반환값',
    '노출하지 않는다'
  ]
);

assert.equal(countOccurrences(googleSection, '`public.users` 자동 생성'), 1);
assert.equal(countOccurrences(googleSection, '운영 Google provider 활성화'), 1);
assert.equal(countOccurrences(googleSection, '실제 Google 로그인 검증'), 1);
assert.equal(countOccurrences(googleSection, '서버의 명시적 사용자 연결 절차'), 1);
assert.equal(countOccurrences(googleSection, 'Kakao OAuth 미구현'), 1);
assert.equal(countOccurrences(googleSection, 'Apple OAuth 미구현'), 1);
assert.equal(countOccurrences(googleSection, '임의의 외부 origin'), 1);

assert.equal(countOccurrences(googleSection, 'public 사용자 자동 생성'), 0);
assert.equal(countOccurrences(googleSection, '운영 provider 활성화와 실제 로그인 검증'), 0);
assert.equal(countOccurrences(googleSection, '서버 명시적 사용자 연결 절차'), 0);
assert.equal(countOccurrences(googleSection, '애플리케이션 세션 반환값'), 0);
assert.equal(countOccurrences(googleSection, 'Kakao OAuth와 Apple OAuth도 지원하지 않는다'), 0);

assert.ok(
  googleSection.includes(
    'Supabase SDK가 반환하는 OAuth URL이나 token을 사용자 화면, 로그 또는 애플리케이션 반환값에 노출하지 않는다.'
  )
);


console.log('Web auth UTF-8 tests passed');
