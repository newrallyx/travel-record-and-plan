@echo off
title 旅行轨迹记录软件 - 首次初始化

cd /d "%~dp0"

echo ======================================
echo   旅行轨迹记录软件 - 首次初始化
echo ======================================
echo.

if not exist "package.json" (
    echo [错误] 当前目录下未找到 package.json
    echo 请把本文件放在项目根目录后再运行。
    echo.
    pause
    exit /b 1
)

if not exist "backend\src\index.js" (
    echo [错误] 未找到 backend\src\index.js
    echo 请确认当前项目目录结构是否完整。
    echo.
    pause
    exit /b 1
)

node -v >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js
    echo.
    echo 请先安装 Node.js 20 LTS 或更高版本
    echo 下载地址: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

npm -v >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 npm
    echo.
    echo 请确认 Node.js 是否安装完整
    echo.
    pause
    exit /b 1
)

echo [1/1] 正在安装项目依赖...
call npm install
if errorlevel 1 (
    echo.
    echo [失败] 项目依赖安装失败
    echo 请检查网络或 npm 配置后重试。
    echo.
    pause
    exit /b 1
)

echo.
echo [完成] 初始化成功
echo 以后直接双击“启动程序.bat”即可运行
echo.
pause