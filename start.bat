@echo off
chcp 65001 >nul
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║         PHOTOBOOTH V1  —  INICIO            ║
echo  ╚══════════════════════════════════════════════╝
echo.

echo  Liberando puertos 8765 y 8766 si estan ocupados...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765 " 2^>nul') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8766 " 2^>nul') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 /nobreak >nul

echo  Iniciando backend Python (WebSocket)...

rem -- Usar Python del entorno virtual si existe, si no buscar en PATH ----------
set VENV_PYTHON=%~dp0.venv\Scripts\python.exe
if exist "%VENV_PYTHON%" (
    set PYTHON=%VENV_PYTHON%
    echo  Usando entorno virtual: %VENV_PYTHON%
) else (
    echo  AVISO: .venv no encontrado, buscando Python en el PATH...
    echo  Ejecuta setup.bat primero para crear el entorno virtual.
    set PYTHON=
    for /f "delims=" %%i in ('where python3 2^>nul') do if not defined PYTHON set PYTHON=%%i
    if not defined PYTHON (
        for /f "delims=" %%i in ('where python 2^>nul') do if not defined PYTHON set PYTHON=%%i
    )
    if not defined PYTHON (
        echo  ERROR: No se encontro Python en el PATH.
        pause & exit /b 1
    )
    echo  Python encontrado: %PYTHON%
)

start "Photobooth Backend" cmd /k ""%PYTHON%" "%~dp0backend\photobooth_backend.py""

echo  Esperando 4 s para que el backend arranque...
timeout /t 4 /nobreak >nul

echo  Iniciando frontend Electron + React...
cd /d "%~dp0frontend"
npm run start
