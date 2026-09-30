@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  start "CampLayoutServer" /min cmd /c "py -3 -m http.server 8000"
) else (
  start "CampLayoutServer" /min cmd /c "python -m http.server 8000"
)
timeout /t 1 /nobreak >nul
start "" "http://localhost:8000"
endlocal
