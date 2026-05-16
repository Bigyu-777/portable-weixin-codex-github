@echo off
setlocal
cd /d %~dp0

if "%1"=="" (
  node dist\standalone.js run
  goto :eof
)

if /i "%1"=="login" (
  node dist\standalone.js login
  goto :eof
)

if /i "%1"=="logout" (
  node dist\standalone.js logout
  goto :eof
)

if /i "%1"=="run" (
  node dist\standalone.js run
  goto :eof
)

echo Usage:
echo   standalone-run.bat login
echo   standalone-run.bat run
echo   standalone-run.bat logout
