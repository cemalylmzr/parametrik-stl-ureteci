@echo off
cd /d "%~dp0.."
echo Parametrik 3D STL Ureteci yeniden derleniyor...
call npm.cmd run build
if %errorlevel% neq 0 (
  echo Derleme hatasi olustu!
  pause
  exit /b 1
)
echo Derleme tamamlandi!
pause
