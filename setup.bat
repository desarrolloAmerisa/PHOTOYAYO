@echo off
chcp 65001 >nul
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║         PHOTOBOOTH V1  —  SETUP             ║
echo  ╚══════════════════════════════════════════════╝
echo.

rem ============================================================
rem [1/3] Buscar Python del sistema (ignorar stubs de WindowsApps)
rem ============================================================
echo  [1/3] Buscando Python del sistema...
set SYS_PYTHON=

rem Recorre TODOS los python/python3 en PATH y se queda con el primero
rem que NO sea el stub de Windows Store (WindowsApps) y que funcione de verdad.
for /f "delims=" %%i in ('where python 2^>nul') do (
    if not defined SYS_PYTHON (
        echo %%i | findstr /i "WindowsApps" >nul
        if errorlevel 1 (
            rem Verificar que este ejecutable realmente funciona
            "%%i" --version >nul 2>&1
            if not errorlevel 1 set SYS_PYTHON=%%i
        )
    )
)
for /f "delims=" %%i in ('where python3 2^>nul') do (
    if not defined SYS_PYTHON (
        echo %%i | findstr /i "WindowsApps" >nul
        if errorlevel 1 (
            "%%i" --version >nul 2>&1
            if not errorlevel 1 set SYS_PYTHON=%%i
        )
    )
)

rem Buscar tambien rutas comunes de instalacion manual
if not defined SYS_PYTHON (
    for %%v in (313 312 311 310 39 38) do (
        if not defined SYS_PYTHON (
            if exist "%LOCALAPPDATA%\Programs\Python\Python%%v\python.exe" (
                set SYS_PYTHON=%LOCALAPPDATA%\Programs\Python\Python%%v\python.exe
            )
        )
    )
)

if not defined SYS_PYTHON (
    echo.
    echo  ERROR: No se encontro una instalacion real de Python en este equipo.
    echo  El acceso directo de la Microsoft Store NO es Python.
    echo.
    echo  Solucion:
    echo    1. Ve a https://www.python.org/downloads/
    echo    2. Descarga e instala Python 3.10 o superior
    echo    3. Marca "Add Python to PATH" durante la instalacion
    echo    4. Vuelve a ejecutar este setup
    echo.
    pause & exit /b 1
)
echo  Python del sistema: %SYS_PYTHON%

rem ============================================================
rem [2/3] Crear / reutilizar entorno virtual en .venv
rem ============================================================
echo.
echo  [2/3] Configurando entorno virtual (.venv)...
set VENV_DIR=%~dp0.venv

if exist "%VENV_DIR%\Scripts\python.exe" (
    echo  Entorno virtual existente detectado, reutilizando.
) else (
    echo  Creando entorno virtual en .venv ...
    "%SYS_PYTHON%" -m venv "%VENV_DIR%"
    if %errorlevel% neq 0 (
        echo  ERROR: No se pudo crear el entorno virtual.
        pause & exit /b 1
    )
    echo  Entorno virtual creado correctamente.
)

set PYTHON=%VENV_DIR%\Scripts\python.exe

echo  Actualizando pip dentro del venv...
"%PYTHON%" -m pip install --upgrade pip --quiet

echo  Instalando dependencias de Python...
"%PYTHON%" -m pip install -r "%~dp0backend\requirements.txt"
if %errorlevel% neq 0 (
    echo  ERROR: pip install fallo.
    pause & exit /b 1
)

rem ============================================================
rem [3/3] Dependencias de Node.js
rem ============================================================
echo.
echo  [3/3] Instalando dependencias de Node.js...
cd /d "%~dp0frontend"
npm install
if %errorlevel% neq 0 (
    echo  ERROR: npm install fallo. Asegurate de tener Node.js instalado.
    pause & exit /b 1
)

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║   Setup completo. Ejecuta start.bat         ║
echo  ╚══════════════════════════════════════════════╝
pause
