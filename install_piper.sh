#!/bin/bash
# Script para descargar e instalar PiperTTS y un modelo de voz en Español
echo "Instalando Piper TTS localmente en la torre..."

mkdir -p piper_tts
cd piper_tts

# Descargar binario de Piper para Linux x86_64
echo "Descargando binario de Piper..."
wget -q --show-progress https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
tar -xf piper_linux_x86_64.tar.gz
mv piper/* .
rm -rf piper piper_linux_x86_64.tar.gz

# Descargar modelo de voz en Español (Davefx - Medium - Voz masculina tipo Jarvis)
echo "Descargando modelo de voz en Español (Masculino)..."
wget -q --show-progress "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx?download=true" -O voice.onnx
wget -q --show-progress "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json?download=true" -O voice.onnx.json

echo "✅ PiperTTS y el nuevo modelo de voz instalados correctamente en la carpeta piper_tts/"
