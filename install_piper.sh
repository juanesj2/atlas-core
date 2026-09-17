#!/bin/bash
# Script para descargar e instalar PiperTTS y un modelo de voz en Español
echo "Limpiando instalación anterior de Piper..."
rm -rf piper_tts
mkdir -p piper_tts
cd piper_tts

# Descargar binario de Piper para Linux x86_64
echo "Descargando binario de Piper..."
wget -q --show-progress https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz

# Extraer el contenido ignorando la carpeta principal para no sobreescribir
tar -xf piper_linux_x86_64.tar.gz --strip-components=1
rm piper_linux_x86_64.tar.gz
chmod +x piper

# Descargar modelo de voz en Español (CarlFM - x_low - Voz masculina grave)
echo "Descargando modelo de voz en Español (Masculino grave)..."
wget -q --show-progress "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/carlfm/x_low/es_ES-carlfm-x_low.onnx?download=true" -O voice.onnx
wget -q --show-progress "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/carlfm/x_low/es_ES-carlfm-x_low.onnx.json?download=true" -O voice.onnx.json

echo "✅ PiperTTS y la nueva voz masculina instalados correctamente en la carpeta piper_tts/"
