@echo off
cd /d "%~dp0"
echo ========================================================
echo   Installing Root CA Certificate into Windows Store...
echo ========================================================
certutil -user -addstore -f "ROOT" "%LOCALAPPDATA%\NetworkWebFilterProxy\certs\ca.crt" 2>nul
if %errorlevel% neq 0 (
    certutil -user -addstore -f "ROOT" "%~dp0..\certs\ca.crt" 2>nul
)
echo Certificate installed successfully!
pause