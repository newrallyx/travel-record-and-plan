@echo off
title 旅行轨迹记录软件 - 前端服务

cd /d "%~dp0"

echo ======================================
echo   旅行轨迹记录软件 - 前端服务
echo ======================================
echo.

call npm run dev:frontend

echo.
echo [前端已退出]
pause