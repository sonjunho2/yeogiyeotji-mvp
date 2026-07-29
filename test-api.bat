@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js를 찾을 수 없습니다.
  pause
  exit /b 1
)
node server\test-api.js
pause
