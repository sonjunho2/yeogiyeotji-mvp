# 여기였지 MVP 통합 패키지

사진과 위치로 좋은 장소를 저장하고 지도, 기억, 컬렉션으로 다시 찾는 앱의 첫 통합 버전입니다.

## 초보자용 실행

Windows에서는 `start-local.bat`를 더블클릭하세요.

또는 VS Code 터미널에서:

```powershell
npm start
```

브라우저에서 `http://localhost:4100`을 엽니다.

상세 안내는 `SETUP_WINDOWS_BEGINNER.md`를 확인하세요.

### VS Code에서 모바일 화면 확인하기

1. VS Code에서 이 저장소 폴더를 엽니다.
2. 통합 터미널에서 `npm start`를 실행합니다.
3. 실행 및 디버그에서 **여기였지: 통합 브라우저 열기**를 실행합니다. 서버까지 한 번에 시작하려면 **여기였지: 서버 + 통합 브라우저**를 실행합니다.
4. 통합 브라우저의 개발자 도구에서 모바일 에뮬레이션 툴바를 켜고 폭을 390px로 확인합니다.
5. 별도 통합 터미널에서 `npm test`를 실행합니다.
6. 개발 서버가 실행 중인 터미널에서 `Ctrl+C`를 눌러 서버를 종료합니다.

## 폴더

- `apps/web-prototype`: 브라우저에서 즉시 확인하는 PWA
- `apps/native-source`: Expo/React Native 앱 소스와 자동 설치 스크립트
- `server`: Node.js MVP API
- `docs`: 개발 로드맵

## 테스트

```powershell
npm test
```

## Figma

https://www.figma.com/design/H8kwE7GD8F3WqLZKwsmwVj
