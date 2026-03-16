@echo off
echo ===================================================
echo   Nexus - Right-Click Context Menu (Windows)
echo ===================================================
echo.
echo ON WINDOWS: The best way to use Nexus is via the Tactical Hub.
echo.
echo This script will verify your environment for Antigravity.
echo.

set PYTHON_CMD=python3
where %PYTHON_CMD% >nul 2>&1
if %errorlevel% neq 0 set PYTHON_CMD=python

%PYTHON_CMD% -c "import os; print('✅ Python Detected')"
node -v >nul 2>&1 && echo ✅ Node.js Detected || echo ❌ Node.js Missing

echo.
echo To "Open with Nexus", simply run 'nexus-hub.bat' in your project folder.
echo.
pause
