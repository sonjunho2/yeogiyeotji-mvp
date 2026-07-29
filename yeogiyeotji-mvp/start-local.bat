@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js를 찾을 수 없습니다.
  echo Node.js LTS 설치 후 다시 실행하세요.
  pause
  exit /b 1
)

echo 여기였지 로컬 서버를 시작합니다.
echo 서버 창은 앱을 확인하는 동안 닫지 마세요.
start "여기였지 서버" cmd /k "cd /d ""%~dp0"" && node server\server.js"
timeout /t 2 /nobreak >nul
start "" http://localhost:4100
