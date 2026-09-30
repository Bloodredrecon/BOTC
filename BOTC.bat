@echo off
rem BOTC Companion launcher: double-click for the menu, or run "BOTC.bat start|stop|restart|status".
title BOTC Companion
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\botc.ps1" %*
set BOTC_EXIT=%ERRORLEVEL%
if "%~1"=="" if not "%BOTC_EXIT%"=="0" pause
exit /b %BOTC_EXIT%
