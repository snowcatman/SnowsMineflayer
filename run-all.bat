@echo off
:: Store the root directory and always start there
set "ROOT_DIR=%CD%"
echo Working from root directory: %ROOT_DIR%

:: Add timestamp to log messages
echo [%date% %time%] Starting from directory: %ROOT_DIR% >> logs\startup.log

:: Create logs directory if it doesn't exist
if not exist "logs" mkdir "logs"
if not exist "minecraft-server\logs" mkdir "minecraft-server\logs"

:: Clear previous log files
echo Clearing previous logs...
if exist "logs\bot-latest.log" del /f "logs\bot-latest.log"
if exist "minecraft-server\logs\latest.log" del /f "minecraft-server\logs\latest.log"

echo Starting Minecraft Server and Bot...
cd minecraft-server
set "SERVER_DIR=%CD%"
echo Server directory: %SERVER_DIR%

:: Check for server.jar
if not exist server.jar (
    echo Error: server.jar not found in: %CD%
    cd ..
    pause
    exit /b
)

:: Start the server with visible output
echo Starting Minecraft server - please wait...
start "Minecraft Server Console" cmd /c "java -jar -Xms1G -Xmx1G server.jar -nogui"

:: Wait for "Done" message with the exact format
:checkserver
findstr /c:"[Server thread/INFO]: Done" ".\logs\latest.log" >nul
if errorlevel 1 (
    :: Check for server crash or error
    findstr /c:"Error" /c:"Exception" /c:"crashed" ".\logs\latest.log" >nul
    if not errorlevel 1 (
        echo Server error detected! Full log:
        type ".\logs\latest.log"
        cd ..
        pause
        exit /b
    )
    echo Waiting for server to finish starting...
    timeout /t 2 /nobreak > nul
    goto checkserver
)

:: Add extra delay for server initialization
echo Server reports ready, waiting additional time for full initialization...
timeout /t 10 /nobreak
echo.

:: Server is ready, now start bot with detailed checks
cd "%ROOT_DIR%"
echo =============================
echo Starting Bot Process
echo Current directory: %CD%
echo.
echo Checking for node.js...
node --version
echo.
echo Checking for door-bot.js...
dir door-bot.js
echo.
echo Starting bot...
echo =============================

:: Start bot with explicit error checking
start "Door Bot Console" /max cmd /k "cd %ROOT_DIR% && echo Starting from: %CD% && node --trace-warnings door-bot.js || (echo Bot failed to start! Error: %ERRORLEVEL% && pause)"

:: Verify bot started
timeout /t 2 /nobreak > nul
echo Checking for bot process...
tasklist | findstr "node.exe"
if errorlevel 1 (
    echo ERROR: Bot process not found!
    echo [%date% %time%] ERROR: Bot process not found >> logs\startup.log
    pause
)

echo.
echo Server and bot should now be running.
echo Press any key to stop both processes...
pause

:: Shutdown sequence
echo Starting shutdown sequence...

:: Try to stop bot gracefully first
echo Attempting to stop bot...
taskkill /FI "WINDOWTITLE eq Door Bot Console*" /T /F
timeout /t 2 /nobreak > nul

:: Stop the server gracefully
echo Attempting to stop server...
cd minecraft-server
echo stop > stop.txt
timeout /t 5 /nobreak > nul

:: Force kill any remaining processes
echo Cleaning up any remaining processes...
taskkill /FI "WINDOWTITLE eq Minecraft Server Console*" /T /F
taskkill /FI "WINDOWTITLE eq Door Bot Console*" /T /F

:: Return to root directory
cd "%ROOT_DIR%"
echo Finished in directory: %CD%
echo [%date% %time%] Ending in directory: %CD% >> logs\startup.log

echo.
echo Shutdown complete.
pause
