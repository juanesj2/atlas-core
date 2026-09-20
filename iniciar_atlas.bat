@echo off
color 0b
echo ========================================================
echo        ATLAS AI - SCRIPT DE INICIO UNIFICADO
echo ========================================================
echo.
echo Este script arrancara los DOS servidores necesarios:
echo 1. El motor de IA en Python (Reconocimiento de Voz)
echo 2. El servidor Node.js (WebSockets y Cerebro Qwen)
echo.

echo [PASO 1] Comprobando/Instalando dependencias de Python (FastAPI, Uvicorn)...
python -m pip install -q fastapi uvicorn pydantic speechbrain faster-whisper torch

echo.
echo [PASO 1.5] Comprobando modelo de Embeddings en Ollama (para Memoria RAG)...
ollama pull nomic-embed-text

echo.
echo [PASO 2] Lanzando Motor de IA (Python) en una ventana nueva...
:: Abre una nueva terminal dedicada a la IA para poder ver sus logs por separado
start "ATLAS - MOTOR IA (PYTHON)" cmd /k "color 0d && echo Iniciando Microservicio de Biometria y STT... && uvicorn src.biometrics.server:app --port 8000"

echo.
echo [PASO 3] Esperando 5 segundos para que la IA cargue los modelos en VRAM...
timeout /t 5 /nobreak >nul

echo.
echo [PASO 4] Arrancando Servidor Principal (Node.js)...
:: Usa la ventana actual para Node.js
color 0a
node src/index.js

pause
