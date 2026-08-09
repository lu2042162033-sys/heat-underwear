@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo 未找到 Python，请先安装 Python 3.8+（安装时勾选 Add Python to PATH）。
    pause
    exit /b
  )
  echo 服务启动中，请保持本窗口打开；浏览器访问 http://localhost:3000
  py server.py
) else (
  echo 服务启动中，请保持本窗口打开；浏览器访问 http://localhost:3000
  python server.py
)
pause
