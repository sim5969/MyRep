@echo off
chcp 65001 >nul
rem Запуск конфигуратора секций АСУ ТП НТ53 из папки dist рядом с этим файлом.
rem Браузер не открывает сборку двойным щелчком по index.html (Chrome/Edge запрещают
rem модули со схемы file:), поэтому поднимаем локальный веб-сервер Python и открываем
rem http://localhost:8653/ — адрес localhost нужен и для окна «Сохранить как».
set PORT=8653
cd /d "%~dp0dist"
if errorlevel 1 (
  echo Папка dist не найдена рядом с этим файлом.
  pause
  exit /b 1
)
set PY=
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo Нужен Python 3 ^(https://www.python.org/downloads/^): без него сборку из папки не открыть.
  pause
  exit /b 1
)
start "Конфигуратор НТ53 — сервер, закрыть по окончании работы" /min %PY% -m http.server %PORT% --bind 127.0.0.1
ping -n 2 127.0.0.1 >nul
start "" http://localhost:%PORT%/