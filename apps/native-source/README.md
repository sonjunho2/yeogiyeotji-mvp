# 여기였지 Expo/React Native 소스

실제 Android/iOS 앱 개발의 출발점입니다. 설치 스크립트가 최신 Expo 프로젝트를 생성한 뒤, Expo SDK와 호환되는 패키지 버전을 자동 설치합니다.

## Windows PowerShell

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup-expo.ps1
cd yeogiyeotji-app
npx expo start
```

스마트폰에 Expo Go를 설치하고 표시되는 QR 코드를 스캔하면 됩니다.

## 현재 구현

- 실제 지도와 장소 마커
- 사진 선택
- 현재 위치 권한 및 좌표 저장
- 장소 이름, 메모, 카테고리, 태그, 공개 범위
- 기억 타임라인
- 컬렉션 목록과 생성
- 장소 상세와 삭제
- AsyncStorage 로컬 저장

## 다음 연결 작업

- Node.js/Express API
- PostgreSQL/PostGIS
- S3 호환 이미지 저장소
- 이메일·소셜 로그인
- 공유 링크와 웹 공개 페이지
- 푸시 알림
- 신고·차단·관리자 페이지
- AdMob 및 제휴 링크
