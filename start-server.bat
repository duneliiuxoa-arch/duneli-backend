@echo off
title Duneli Database Server - Auto Setup
color 0A

echo.
echo  ================================================
echo   DUNELI DATABASE SERVER — AUTO START SETUP
echo  ================================================
echo.

:: Check if Node is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Please install Node.js first.
    pause
    exit /b 1
)

:: Check if PM2 is installed globally
pm2 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] PM2 not found. Installing PM2 globally...
    npm install -g pm2
    echo [OK] PM2 installed.
) else (
    echo [OK] PM2 already installed.
)

:: Go to project directory
cd /d "%~dp0"
echo [INFO] Working directory: %cd%

:: Check if already running under PM2
pm2 list | findstr "duneli-db" >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] duneli-db already running in PM2. Restarting...
    pm2 restart duneli-db
) else (
    echo [INFO] Starting duneli-db with PM2...
    pm2 start server.js --name "duneli-db" --interpreter node
)

:: Save PM2 process list so it survives reboot
pm2 save
echo [OK] PM2 process list saved.

:: Register PM2 to run on Windows startup (via pm2-startup or scheduled task)
echo.
echo [INFO] Setting up Windows auto-start...
pm2 startup windows 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Creating Windows Task Scheduler entry for auto-start...
    schtasks /query /tn "DuneliDBAutoStart" >nul 2>&1
    if %errorlevel% neq 0 (
        schtasks /create /tn "DuneliDBAutoStart" /tr "pm2 resurrect" /sc ONLOGON /ru "%USERNAME%" /f
        echo [OK] Task Scheduler entry created: DuneliDBAutoStart
    ) else (
        echo [OK] Task Scheduler entry already exists.
    )
)

echo.
echo  ================================================
echo   SERVER STATUS:
echo  ================================================
pm2 list
echo.
echo  [DONE] Duneli DB is running! 
echo  [DONE] It will AUTO-START on every Windows boot.
echo  [DONE] Aab dobara node server.js nahi likhna padega!
echo.
echo  Useful commands:
echo    pm2 list          — running processes dekho
echo    pm2 logs duneli-db — server logs dekho  
echo    pm2 stop duneli-db — server band karo
echo    pm2 restart duneli-db — restart karo
echo.
pause
