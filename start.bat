@echo off
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
if not exist node_modules (
  echo Installing components, first run only...
  call npm install
)
call npm start
