@echo off
title 旅行轨迹记录软件 - 启动程序

cd /d "%~dp0"

echo ======================================
echo   旅行轨迹记录软件 - 启动程序
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

if not exist "启动后端.bat" (
    echo [错误] 未找到 启动后端.bat
    echo 请确认该文件与本文件位于同一目录。
    echo.
    pause
    exit /b 1
)

if not exist "启动前端.bat" (
    echo [错误] 未找到 启动前端.bat
    echo 请确认该文件与本文件位于同一目录。
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [提示] 未检测到 node_modules，正在执行首次初始化...
    call "%~dp0首次初始化.bat"
)

echo [步骤 1/3] 打开后端窗口...
start "" "%~dp0启动后端.bat"

timeout /t 2 /nobreak >nul

echo [步骤 2/3] 打开前端窗口...
start "" "%~dp0启动前端.bat"

timeout /t 5 /nobreak >nul

echo [步骤 3/3] 打开浏览器...
start "" "http://localhost:5173"

echo.
echo [完成] 已启动前后端服务
echo 浏览器地址：http://localhost:5173
echo.
echo 使用结束后，请双击“关闭程序.bat”关闭服务。
echo.
pause