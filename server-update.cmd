@echo off
setlocal

set "APP_DIR=C:\inetpub\wwwroot\MessageSender.AssignPros"
set "APP_POOL=MessageSender.AssignPros"
set "WARMUP_URL=https://messages.assignpros.com/"
set "APPCMD=%windir%\System32\inetsrv\appcmd.exe"

echo [1/4] Switching to %APP_DIR%
if not exist "%APP_DIR%\package.json" (
  echo ERROR: package.json not found in %APP_DIR%
  exit /b 1
)

cd /d "%APP_DIR%"
if errorlevel 1 (
  echo ERROR: Could not change directory to %APP_DIR%
  exit /b 1
)

echo [2/4] Running npm ci --omit=dev
call npm ci --omit=dev
if errorlevel 1 (
  echo ERROR: npm ci failed
  exit /b 1
)

echo [3/4] Recycling IIS app pool: %APP_POOL%
if not exist "%APPCMD%" (
  echo ERROR: appcmd not found at %APPCMD%
  echo Run this script on the IIS server.
  exit /b 1
)

"%APPCMD%" recycle apppool /apppool.name:"%APP_POOL%"
if errorlevel 1 (
  echo ERROR: Failed to recycle app pool %APP_POOL%
  exit /b 1
)

echo [4/4] Warming site: %WARMUP_URL%
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%WARMUP_URL%' -UseBasicParsing -TimeoutSec 30 ^| Out-Null; Write-Host 'Warm-up request completed.' } catch { Write-Host 'WARNING: Warm-up request failed. App pool is still recycled.' }"

echo SUCCESS: Deploy update steps completed.
endlocal
exit /b 0
