# 여기였지 Windows 초보자 설치 안내

## 1. 가장 먼저 로컬에서 확인

1. 압축을 `C:\Users\사용자이름\Documents\projects\yeogiyeotji-mvp` 같은 짧은 경로에 풉니다.
2. 압축을 푼 폴더 안의 `start-local.bat`를 더블클릭합니다.
3. 검은 서버 창을 닫지 않습니다.
4. 브라우저가 자동으로 열리지 않으면 `http://localhost:4100`을 입력합니다.
5. 종료할 때 검은 서버 창에서 `Ctrl + C`를 누르고 창을 닫습니다.

## 2. VS Code로 열기

1. VS Code 실행
2. `파일 > 폴더 열기`
3. 압축을 푼 `yeogiyeotji-mvp-beginner` 폴더 선택
4. `터미널 > 새 터미널`
5. `npm start` 입력
6. 브라우저에서 `http://localhost:4100` 열기

## 3. GitHub Desktop에 올리기

1. GitHub Desktop 실행 후 로그인
2. `File > Add local repository`
3. 프로젝트 폴더 선택
4. 저장소가 아니라고 표시되면 `create a repository` 선택
5. Name은 `yeogiyeotji-mvp`, Git ignore는 `None`, License도 `None`
6. 첫 커밋 메시지에 `chore: initial 여기였지 MVP` 입력
7. `Commit to main`
8. `Publish repository`
9. 전체 소스 백업만 원하면 `Keep this code private` 체크 유지
10. 무료 GitHub Pages 공개 데모를 쓰려면 공개 저장소가 필요하므로 체크 해제

## 4. GitHub Pages 공개 데모

1. GitHub 웹사이트에서 저장소 열기
2. `Settings > Pages`
3. `Build and deployment > Source`를 `GitHub Actions`로 선택
4. `Actions` 탭에서 배포 완료 확인
5. `Settings > Pages`에 표시된 주소로 접속

주의: GitHub Pages는 정적 웹 프로토타입만 공개합니다. Node.js API와 JSON 데이터 저장 서버는 실행하지 않습니다.
