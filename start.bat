@echo off
setlocal EnableExtensions
chcp 65001 >nul
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║         PHOTOBOOTH V1  —  INICIO            ║
echo  ╚══════════════════════════════════════════════╝
echo.

rem Carpeta del proyecto (comillas: rutas con espacios o parentesis)
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo  Liberando puertos 8765 y 8766 si estan ocupados...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765 " 2^>nul') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8766 " 2^>nul') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 /nobreak >nul

echo  Iniciando backend Python (WebSocket)...

rem -- Usar Python del entorno virtual si existe, si no buscar en PATH ----------
set "VENV_PYTHON=%ROOT%\.venv\Scripts\python.exe"
set "PYTHON="
if exist "%VENV_PYTHON%" goto :use_venv
goto :use_path

:use_venv
set "PYTHON=%VENV_PYTHON%"
echo  Usando entorno virtual: %VENV_PYTHON%
goto :run_backend

:use_path
echo  AVISO: .venv no encontrado, buscando Python en el PATH...
echo  Ejecuta setup.bat primero para crear el entorno virtual.
for /f "delims=" %%i in ('where python3 2^>nul') do if not defined PYTHON set "PYTHON=%%i"
if not defined PYTHON for /f "delims=" %%i in ('where python 2^>nul') do if not defined PYTHON set "PYTHON=%%i"
if not defined PYTHON (
    echo  ERROR: No se encontro Python en el PATH.
    pause
    exit /b 1
)
echo  Python encontrado: %PYTHON%

:run_backend
start "Photobooth Backend" /D "%ROOT%\backend" "%PYTHON%" photobooth_backend.py

echo  Esperando 4 s para que el backend arranque...
timeout /t 4 /nobreak >nul

echo  Iniciando frontend Electron + React...
cd /d "%ROOT%\frontend"
npm run start
endlocal
