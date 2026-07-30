# 여기였지 MVP 통합 패키지

사진과 위치로 좋은 장소를 저장하고 지도, 기억, 컬렉션으로 다시 찾는 앱의 통합 버전입니다.

## 실행

Windows에서는 `start-local.bat`를 더블클릭하거나 터미널에서 다음 명령을 실행합니다.

```powershell
npm start
```

브라우저에서 `http://localhost:4100`을 엽니다. localhost로 실행하면 장소와 컬렉션은 Node.js API를 통해 `server/data/store.json`에 저장됩니다. GitHub Pages에서는 서버가 없으므로 기존처럼 해당 브라우저의 localStorage에 저장됩니다. localhost 서버 연결이 끊기면 기존 브라우저 데이터를 지우지 않고 localStorage 방식으로 전환합니다.

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

## Figma

https://www.figma.com/design/H8kwE7GD8F3WqLZKwsmwVj
