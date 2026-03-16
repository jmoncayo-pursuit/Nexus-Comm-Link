@echo off
cls
echo.
echo  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗
echo  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝
echo  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗
echo  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║
echo  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║
echo  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
echo            COMM-LINK TACTICAL HUB           
echo.

set PYTHON_CMD=python3
where %PYTHON_CMD% >nul 2>&1
if %errorlevel% neq 0 (
    set PYTHON_CMD=python
)

echo [1] Launch ^& Link Antigravity (Premium)
echo [2] Start Bridge Only (Local WiFi)
echo [3] Start Bridge Only (Global Web)
echo [4] Exit
echo.
set /p choice="Selection > "

if "%choice%"=="1" (
    %PYTHON_CMD% launcher.py --mode local --link antigravity
) else if "%choice%"=="2" (
    %PYTHON_CMD% launcher.py --mode local
) else if "%choice%"=="3" (
    %PYTHON_CMD% launcher.py --mode web
) else (
    echo Exiting...
)
pause
