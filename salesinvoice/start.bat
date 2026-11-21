@echo off
title TradeDocs - Local Offline Trade Documents
cd /d "%~dp0"

echo.
echo   ==========================================
echo     TradeDocs / 外贸单证工作台 (本地离线)
echo   ==========================================
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  echo   [1/2] 正在启动本地服务 ...
  start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8080/"
  node server.mjs 8080
  goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo   [1/2] 未检测到 Node.js，改用 Python 启动 ...
  start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8080/"
  python -m http.server 8080 --bind 127.0.0.1
  goto :end
)

echo   未检测到 Node.js 或 Python，无法启动本地服务。
echo.
echo   解决办法（任选其一）：
echo     A. 安装 Node.js 后重新双击本文件
echo     B. 在本文件夹执行： python -m http.server 8080
echo.
echo   注意：不要直接双击 index.html —— 浏览器安全策略会拦截本地模块加载，
echo         必须通过上面的本地服务地址访问。
echo.
pause

:end
