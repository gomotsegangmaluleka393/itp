@echo off
rem Starts the HMF server on this computer. Double-click to run.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages...
  call npm install
)
start "" http://localhost:3000
call npm start
pause
