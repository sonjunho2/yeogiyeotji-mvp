# 여기였지 MVP 통합 패키지

사진과 위치로 좋은 장소를 저장하고 지도, 기억, 컬렉션으로 다시 찾는 앱의 통합 버전입니다.

## 실행

Windows에서는 `start-local.bat`를 더블클릭하거나 터미널에서 다음 명령을 실행합니다.

```powershell
npm start
```

브라우저에서 `http://localhost:4100`을 엽니다. localhost 서버 모드에서는 회원가입 또는 로그인 후 장소와 컬렉션을 사용할 수 있으며, 데이터는 Node.js API를 통해 `server/data/store.json`에 저장됩니다. 처음에는 로그인 화면에서 이메일, 비밀번호, 표시 이름을 입력해 가입합니다. 이후에는 같은 이메일과 비밀번호로 로그인하고 설정 화면에서 로그아웃할 수 있습니다.

GitHub Pages는 로그인 없는 브라우저 데모입니다. 서버가 없으므로 기존처럼 해당 브라우저의 localStorage에 저장되며 설정 화면에 `브라우저 데모 모드`가 표시됩니다. localhost 서버에 실제로 연결할 수 없거나 요청 시간이 초과되면 기존 브라우저 데이터를 지우지 않고 브라우저 저장 방식으로 전환합니다. 서버가 반환한 `401 로그인 필요` 응답은 연결 실패로 취급하지 않습니다.

사진은 별도 이미지 스토리지가 아직 없어 서버와 동기화하지 않습니다. 서버 모드에서도 장소 메타데이터만 서버에 저장하고 사진은 현재 브라우저에만 보관합니다.

자세한 Windows 안내는 `SETUP_WINDOWS_BEGINNER.md`를 확인하세요.

## 폴더

- `apps/web-prototype`: 브라우저에서 확인하는 PWA
- `apps/native-source`: Expo/React Native 테스트 소스와 자동 설치 스크립트
- `server`: Node.js MVP API와 `data/store.json` 데이터 파일
- `docs`: 개발 로드맵

## 테스트

```powershell
npm test
```

API 테스트는 임시 저장소를 사용하므로 `server/data/store.json`을 변경하지 않습니다.

## 개발용 인증과 데이터

- 비밀번호 원문은 저장하지 않습니다. Node.js 내장 `crypto.scrypt`와 사용자별 무작위 salt로 만든 파생 해시만 저장합니다.
- 로그인 세션은 `HttpOnly`, `SameSite=Lax`, `Path=/` 속성의 `yyj_session` 쿠키로 전달합니다. 세션 ID를 localStorage나 sessionStorage에 저장하지 않습니다.
- 세션은 현재 서버 메모리에 7일 동안 유지됩니다. 서버를 재시작하면 세션이 사라지므로 다시 로그인해야 합니다.
- 계정, 장소, 컬렉션 메타데이터의 개발용 저장 파일은 `server/data/store.json`입니다. 사진은 계속 현재 브라우저에만 저장됩니다.
- 기존 `ownerId` 없는 장소와 컬렉션은 레거시 데이터로 파일에 보존되지만 로그인 사용자의 API에는 노출되지 않습니다. 자동으로 특정 계정에 연결하지 않습니다.
- 상태 변경 API는 JSON 요청만 받고, `Origin` 헤더가 있으면 현재 서버 출처와 같은지 확인합니다. 쿠키의 SameSite 정책도 함께 적용합니다.

이 인증은 로컬 개발용 기반 구현이며 운영 배포용 최종 인증이 아닙니다. 운영 전에는 영구 데이터베이스와 세션 저장소, HTTPS 프록시 설정 검증, 로그인 시도 제한, 이메일 인증, 비밀번호 재설정과 보안 모니터링을 추가해야 합니다.

## Figma

https://www.figma.com/design/H8kwE7GD8F3WqLZKwsmwVj
