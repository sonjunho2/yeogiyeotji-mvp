# 통합 인증 아키텍처

## 목표와 범위

한국 우선 출시 후 글로벌 확장을 고려한다. 초기 로그인 수단은 카카오, Google, Apple, 이메일 OTP이며 휴대폰 OTP와 네이버 로그인은 후속 단계다. 이 문서는 설계 문서이며 OAuth 키 설정, Supabase Auth 연결, 실제 로그인 코드 구현을 포함하지 않는다.

## 현재 인증 구조

- Node.js 서버가 자체 이메일/비밀번호 회원가입과 로그인을 처리한다.
- 비밀번호는 `password_salt`, `password_hash`로 저장한다.
- PostgreSQL `sessions` 테이블과 `yyj_session` 쿠키를 사용한다.
- PostgreSQL에는 원본 세션 토큰이 아니라 SHA-256 token hash만 저장한다.
- `public.users.id`가 앱 사용자 ID이며 `places.owner_id`, `collections.owner_id`가 이를 참조한다.
- Supabase는 현재 PostgreSQL 용도이며 Supabase Auth는 아직 연결하지 않았다.

## 목표 인증 구조

Supabase Auth를 장기 인증 주체로 사용하되 `public.users`는 앱 프로필과 데이터 소유권의 주체로 유지한다. 기본 매핑안은 다음과 같다.

- 기존 `public.users.id`를 유지한다.
- `users.auth_user_id UUID NULL`을 추가하고 `UNIQUE` 제약을 둔다.
- 같은 Supabase 프로젝트 DB를 사용하는 경우 `auth.users(id)`를 참조하고 `ON DELETE SET NULL`을 적용하는 안을 검토한다.
- 기존 owner 외래키는 유지한다.

`003_auth_user_mapping.sql`에서 1차 매핑 기반을 실제로 추가했다. 적용 범위는 `users.auth_user_id UUID NULL`과 `UNIQUE` 인덱스까지이며 기존 행은 모두 NULL이다. `auth.users.id`와 `public.users.id`를 동일하게 만들지 않는다. Supabase Auth identities가 provider identity를 관리하고, 서버는 Supabase JWT의 subject를 검증한 뒤 `auth_user_id`를 통해 기존 public 사용자 ID를 찾는다.

Supabase Auth 내부에서는 검증된 같은 이메일의 identities가 하나의 `auth.users` 사용자에 자동 연결될 수 있다. 그러나 이 동작만으로 기존 `public.users`를 자동 병합하거나 `auth_user_id`를 설정하지 않는다. public 사용자 연결에는 기존 비밀번호 재인증, 이메일 OTP 확인, 사용자 확인, 중복 매핑 검사가 필요하다. `auth_user_id`가 이미 다른 public 사용자에 연결되어 있으면 중단한다. normalized email이 다른 public 사용자와 충돌하면 자동 처리하지 않고 복구 또는 관리자 검토 대상으로 격리한다.

## 기존 사용자 마이그레이션과 연결

1. 기존 이메일/비밀번호로 로그인한다.
2. 중요한 연결 작업 전에 비밀번호를 재인증한다.
3. 같은 사용자가 이메일 OTP 또는 social OAuth를 완료한다.
4. Supabase JWT와 subject를 확인한다.
5. `auth_user_id`의 중복 연결 여부를 확인한다.
6. 트랜잭션 안에서 현재 `public.users.auth_user_id`를 설정한다.
7. 기존 owner ID와 데이터 소유권은 변경하지 않는다.
8. 연결 성공 후에도 전환 기간 동안 기존 로그인을 유지한다.
9. 연결에 실패하면 기존 세션과 데이터에 영향을 주지 않는다.

마이그레이션 직후 `auth_user_id`는 null을 허용한다. 기존 비밀번호 사용자가 비밀번호를 잊은 경우에도 본인 확인과 비밀번호 재설정·계정 복구를 통해 데이터 소유권을 잃지 않고 복구할 수 있어야 한다. 본인 확인이 끝나기 전에는 `auth_user_id`를 연결하지 않는다. 기존 자체 비밀번호·세션을 종료하기 전에 미전환 사용자와 복구 가능성을 확인한다.

중복 계정과 이메일 충돌은 이메일이 같다는 이유만으로 병합하지 않는다. 매핑 전, 매핑 후, JWT 적용 전후를 롤백 지점으로 둔다.

## 신규 사용자와 이메일 미제공 provider

카카오·Google·Apple·이메일 OTP가 성공하면 Supabase Auth 사용자를 확인한다. 첫 로그인에서 매핑이 없을 때는 검증된 이메일 또는 추가 인증을 확인한 뒤 `public.users`를 생성한다. 표시 이름이 없으면 보완 입력을 받는다.

provider가 검증된 이메일을 제공하지 않으면 `public.users`를 즉시 만들지 않는다. 이메일 입력과 이메일 OTP 인증을 추가로 완료하게 한 뒤 신규 public 사용자 생성 또는 기존 계정 연결을 진행한다. 완료 전 사용자는 `onboarding pending` 상태이며 앱 데이터에 접근할 수 없다. Apple relay 이메일은 검증된 provider 이메일로 인정할 수 있지만 실제 이메일과 다를 수 있으므로 UI와 계정 복구 정책에서 고려한다. 로그인 취소, provider 오류, 이미 연결된 identity 오류는 각각 명시적으로 처리한다.

## 계정 연결과 해제

설정 화면에 연결된 로그인 수단을 표시한다. 로그인 수단을 추가할 때는 재인증과 callback 검증을 수행한다. 최소 하나의 로그인 수단은 반드시 유지하며 마지막 수단 해제를 거부한다.

계정 탈퇴 순서는 유예·복구 정책을 먼저 확정한 뒤 앱 데이터 삭제 정책 적용, 자체·신규 세션 폐기, 매핑 삭제, Supabase Auth 계정 삭제 순으로 처리한다.

## 서버 인증 우선순위

전환 기간의 요청 인증 우선순위는 다음과 같다.

1. `Authorization: Bearer` 토큰이 있으면 Supabase JWT를 검증한다.
2. JWT가 없을 때만 `yyj_session`으로 fallback한다.
3. JWT와 기존 세션이 모두 있고 서로 다른 사용자를 가리키면 401 또는 409로 거부한다.
4. JWT 검증이 실패했을 때 기존 세션으로 조용히 fallback하지 않는다.
5. 인증 결과를 항상 기존 `public.users.id`로 정규화한 뒤 API 권한을 검사한다.

## JWT 검증

Supabase 프로젝트 JWKS endpoint를 사용한다. 서명, 허용 algorithm, `kid`, issuer, audience, `exp`, `sub`를 검증한다. 직접 암호 알고리즘을 구현하지 않고 검증된 라이브러리를 사용한다. 키 회전과 JWKS 캐시 갱신을 고려한다. service-role key와 JWT secret은 브라우저에 노출하지 않는다. 실제 npm 패키지 이름을 확정하거나 설치하지 않는다.

웹 OAuth callback과 Expo/React Native의 custom scheme 또는 universal/app link callback은 별도로 검증한다. GitHub Pages 브라우저 데모 모드는 API가 없으므로 인증 전환 대상에서 제외한다.

## 데이터베이스 변경 초안

1차 migration은 `users.auth_user_id UUID NULL`과 nullable `UNIQUE` 인덱스만 적용한다. 기존 `public.users.id`와 `places.owner_id`, `collections.owner_id` 외래키는 그대로 유지하며, 이번 단계에서는 `auth.users` 외래키를 추가하지 않는다. Supabase Auth 실제 연동 단계에서 권한, 격리 테스트 스키마, `ON DELETE SET NULL` 정책을 확인한 뒤 별도 migration으로 결정한다.

대안은 `auth_account_links(app_user_id, auth_user_id, linked_at)` 테이블이다. 다중 연결과 이력에는 유연하지만 대표 계정 규칙, 중복 연결 방지, 삭제 정합성이 복잡하다. provider 정보는 Supabase `auth.identities`가 관리한다. provider 변경 이력이 필요하면 별도 감사 로그 테이블로 관리한다.

## 환경변수 계획

실제 값은 작성하지 않는다.

브라우저 공개 설정:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`: secret은 아니지만 권한은 RLS와 서버 검증으로 제한한다.

앱 서버 전용:

- `SUPABASE_URL`
- 필요한 경우 `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_ISSUER`
- `SUPABASE_JWT_AUDIENCE`
- `SUPABASE_JWKS_URL`

외부 provider 및 Supabase Dashboard 설정:

- Kakao client ID와 secret
- Google client ID와 secret
- Apple service/client ID, team ID, key ID, private key 또는 생성된 client secret

provider secret은 브라우저 코드나 Git 저장소에 넣지 않는다. Hosted Supabase에서는 provider 자격 증명을 Supabase Dashboard에 설정한다. service-role key와 JWT secret도 브라우저에 포함하지 않는다.

## 구현과 배포 순서

| 단계 | 배포 전 조건과 테스트 | 롤백 및 기존 로그인 |
|---|---|---|
| 1. 설계와 로드맵 | 문서와 데이터 보존 규칙 검토 | 문서 되돌림, 기존 로그인 유지 |
| 2. DB 매핑 migration | 백업, nullable 매핑, owner 회귀 테스트 | 매핑 비활성화, 기존 로그인 유지 |
| 3. 서버 JWT 검증 | 유효·만료·위조 JWT 테스트 | JWT 경로 비활성화 |
| 4. 이메일 OTP와 이메일 미제공 provider 보완 인증 | 이메일 입력, OTP 만료·재전송, 접근 차단 테스트 | OTP 경로 비활성화 |
| 5. Google | callback·취소·중복 identity 테스트 | provider 비활성화 |
| 6. 카카오 | callback·이메일 미제공 테스트 | provider 비활성화 |
| 7. Apple | relay 이메일·callback 테스트 | provider 비활성화 |
| 8. 기존 사용자 연결 | 소유권·충돌·롤백 테스트 | 매핑 제거, 기존 로그인 유지 |
| 9. 기존 사용자 비밀번호 재설정·계정 복구 | 비밀번호 분실, 이메일 재설정 링크 또는 OTP 만료 테스트 | 복구 경로 롤백, 기존 데이터 유지 |
| 10. 설정 화면 연결·해제 | 마지막 수단 해제 방지 테스트 | UI 롤백 |
| 11. 자체 인증 종료 검토 | 미전환 사용자와 복구 가능성 확인 | 종료 전 단계로 복귀 |
| 12. 휴대폰 OTP와 네이버 | 정책과 개인정보 검토 | 구현 보류 |

## 테스트 계획

기존 사용자 데이터 유지, 신규 사용자 생성, provider별 로그인, 동일 사용자의 다중 identity, 중복 이메일, 이메일 미제공 provider, 로그아웃과 세션 만료, 계정 연결·해제, 계정 삭제, 웹·모바일 callback을 검증한다.

추가로 다음을 검증한다.

- JWT와 `yyj_session`이 서로 다른 사용자를 가리키는 충돌
- 위조 JWT가 기존 세션으로 fallback되지 않는지
- `auth_user_id` 중복 연결 방지
- provider 이메일 미제공 후 OTP 완료 전 데이터 접근 차단
- Supabase 자동 identity linking과 `public.users` 명시적 연결의 분리
- JWKS 키 회전과 알 수 없는 `kid`
- 기존 사용자의 비밀번호 분실 복구
- 이메일 재설정 링크 또는 OTP 만료
- 이미 다른 `public.users`에 연결된 이메일 충돌
- 복구 후 기존 `places.owner_id`와 `collections.owner_id` 유지
- 복구 실패 시 기존 데이터 변경 금지
- 자체 인증 종료 전에 미전환 사용자와 복구 가능성 확인
- 기존 로그인 롤백 시 데이터 소유권 유지

## 결정 사항과 보류 사항

결정 사항:

- Supabase Auth를 장기 인증 시스템으로 사용한다.
- 기존 `public.users.id`와 데이터 소유권을 유지한다.
- 한국 초기 제공자는 카카오, Google, Apple, 이메일 OTP다.
- 휴대폰 OTP와 네이버는 후속 단계다.
- 기존 인증과 신규 인증을 단계적으로 전환한다.

보류 사항:

- SMTP 또는 이메일 발송 서비스 설정
- Apple Developer 설정
- Google OAuth 설정
- Kakao Developers 설정
- 모바일 deep link
- 실제 계정 전환 시작일
- 기존 비밀번호 로그인 종료일

아직 `auth_user_id`를 실제 계정에 연결하는 HTTP API, OAuth, JWT, OTP, 프런트엔드 흐름은 활성화하지 않는다. 실제 인증 코드, 추가 migration SQL, package 설치, `.env` 생성, 키·비밀번호 요청은 이 문서 작업의 범위가 아니다.
