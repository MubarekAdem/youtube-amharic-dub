@echo off
title Amharic Dub Server
cd /d "%~dp0server"
echo ========================================
echo   Starting Amharic Dub Backend Server...
echo ========================================
echo.
node --env-file=.env server.js
pause
