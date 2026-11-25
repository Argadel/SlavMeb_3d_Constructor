@echo off
cd /d "%~dp0"
py -3 server.py
if errorlevel 1 echo If Python launcher is unavailable, run python server.py in this folder.
pause
