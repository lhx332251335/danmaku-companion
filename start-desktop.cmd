@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\.bin\electron.cmd" (
  call npm.cmd install
  if errorlevel 1 exit /b %errorlevel%
)

if not exist "dist-electron\electron\main\main.js" (
  call npm.cmd run build
  if errorlevel 1 exit /b %errorlevel%
)

call node_modules\.bin\electron.cmd dist-electron\electron\main\main.js
