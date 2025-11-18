@echo off
setlocal enabledelayedexpansion
echo ========================================
echo Building Werkstatt Verwaltung Executable
echo ========================================
echo.

REM Change to the script's directory
cd /d "%~dp0"
echo Working directory: %CD%
echo.

REM Clean previous builds
echo [1/5] Cleaning previous build...
if exist "release" (
    echo   Removing old release folder...
    rmdir /s /q "release" 2>nul
)
if exist "build" (
    echo   Removing old build folder...
    rmdir /s /q "build" 2>nul
)
echo   Cleanup complete.
echo.

REM Install dependencies
echo [2/5] Installing dependencies...
call npm install
if !errorlevel! neq 0 (
    echo.
    echo ERROR: npm install failed with error code !errorlevel!
    pause
    exit /b 1
)
echo   Dependencies installed.
echo.

REM Generate icons if SVG exists
echo [3/5] Checking for custom icon...
if exist "icons\icon.svg" (
    echo   Custom icon found. Generating icons...
    call npm run generate-icons
    if !errorlevel! neq 0 (
        echo.
        echo ERROR: Icon generation failed with error code !errorlevel!
        echo Please check your SVG file format.
        pause
        exit /b 1
    )
    echo   Icons generated successfully.
) else (
    echo   No custom icon found. Using default icon.
    echo   To use a custom icon, place your SVG at: icons\icon.svg
)
echo.

REM Build React app and Electron executable
echo [4/5] Building React app...
call npm run build
if !errorlevel! neq 0 (
    echo.
    echo ERROR: React build failed with error code !errorlevel!
    echo Check the error messages above for details.
    pause
    exit /b 1
)
echo   React app built successfully.
echo.

echo [5/5] Creating Electron executable...
call npx electron-builder
if !errorlevel! neq 0 (
    echo.
    echo ERROR: Electron build failed with error code !errorlevel!
    echo Check the error messages above for details.
    pause
    exit /b 1
)
echo   Electron executable created.
echo.

REM Check if executable was created
echo ========================================
if exist "release\Werkstatt Verwaltung Setup 0.1.0.exe" (
    echo BUILD COMPLETED SUCCESSFULLY!
    echo.
    echo Executable location:
    echo   %CD%\release\Werkstatt Verwaltung Setup 0.1.0.exe
    echo.
    echo You can also run the unpacked version:
    echo   %CD%\release\win-unpacked\Werkstatt Verwaltung.exe
) else (
    echo BUILD FAILED!
    echo Executable not found in release folder.
    echo Check the error messages above for details.
)
echo ========================================
echo.
pause
