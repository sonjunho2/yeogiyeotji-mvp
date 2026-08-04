'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const requiredByFile = {
  'apps/web-prototype/app.js': ['여기였지', '이메일 인증코드로 로그인', '전송한 이메일:'],
  'apps/web-prototype/supabase-auth.js': ['이메일 인증 로그인을 사용할 수 없습니다.'],
  'apps/web-prototype/auth-controller.js': ['인증 코드를 보냈습니다. 받은 편지함을 확인해 주세요.', '이 이메일 인증 계정은 아직 여기였지 계정에 연결되지 않았습니다.', '현재 비밀번호 로그인과 다른 이메일 인증 계정입니다.'],
  'docs/UNIFIED_AUTH_ARCHITECTURE.md': ['이메일 OTP 클라이언트 기반', '{{ .Token }}']
};
const forbidden = ['?몄쬆', '?대찓', '紐삵', '?듬땲', '�'];

for (const [file, required] of Object.entries(requiredByFile)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const value of required) assert.ok(text.includes(value), `${file} is missing ${value}`);
  for (const value of forbidden) assert.equal(text.includes(value), false, `${file} contains forbidden mojibake`);
}
console.log('Web auth UTF-8 tests passed');
