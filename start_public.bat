@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
title TracX Public Command Center
cd /d "%~dp0"

echo ===============================================================================
echo Starting Unified TracX Cold Chain Backend + Public Tunnel...
echo ===============================================================================

if exist ".\.venv\Scripts\python.exe" (
    ".\.venv\Scripts\python.exe" start_public.py
) else (
    python start_public.py
)

pause
