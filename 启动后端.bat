@echo off
title 旅行轨迹记录软件 - 后端服务

cd /d "%~dp0"

echo ======================================
echo   旅行轨迹记录软件 - 后端服务
echo ======================================
echo.

call npm run dev:backend

echo.
echo [后端已退出]
pause