@echo off
title 旅行轨迹记录软件 - 关闭程序

echo ======================================
echo   旅行轨迹记录软件 - 关闭程序
echo ======================================
echo.

echo 正在关闭后端服务（3001）...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>nul
)

echo 正在关闭前端服务（5173）...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>nul
)

echo.
echo [完成] 已尝试关闭前后端服务
echo.
pause