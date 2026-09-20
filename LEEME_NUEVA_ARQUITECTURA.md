# 🚀 ATLAS - Nueva Arquitectura de Servidor Dual

Para eliminar los tiempos de espera lentos (Cold-Boot) cuando le hablas por el micrófono a Atlas, el sistema ahora se divide en dos servidores independientes que se comunican entre sí.

## 🧠 1. Servidor de IA (Python)
Este servidor se encarga **únicamente** de la biometría (saber quién eres) y la transcripción (pasar tu voz a texto).
Al arrancar, carga PyTorch y los modelos en la VRAM de tu gráfica (RTX 3060 Ti) y se queda esperando conexiones de manera ultrarrápida.

**Dependencias (Ejecutar una vez):**
```bash
python -m pip install fastapi uvicorn pydantic speechbrain faster-whisper torch
```

**Para arrancarlo manualmente:**
```bash
uvicorn src.biometrics.server:app --port 8000
```
*(Debe estar corriendo en el puerto 8000 para que Node lo encuentre)*

## 🌐 2. Memoria Infinita RAG (Ollama Embeddings)
Ahora Atlas usa un sistema de vectores para recordar cosas de por vida sin saturar la memoria (RAG). Necesitas descargar un mini-modelo en Ollama para que Atlas pueda convertir frases en matemáticas.

**Dependencias (Ejecutar una vez):**
```bash
ollama pull nomic-embed-text
```
*(Si usas el `.bat` que he preparado, lo descargará automáticamente la primera vez).*

---

## 💻 3. Servidor Principal (Node.js)
Este es el cerebro principal de Atlas. Sirve la página web, conecta con Qwen (Ollama), recupera memorias de RAG, lee tus skills y se comunica con el ESP32 por WebSockets.
Cuando recibe audio del ESP32, se lo envía en milisegundos al servidor Python por HTTP.

**Para arrancarlo manualmente:**
```bash
node src/index.js
```

---

## ⚡ Método Fácil (Todo en Uno)
He creado el archivo `iniciar_atlas.bat` en la raíz del proyecto.
Simplemente haz **doble clic en `iniciar_atlas.bat`** y él se encargará de:
1. Comprobar que tienes `fastapi` y `uvicorn` instalados.
2. Abrir una ventana CMD rosa nueva con el Servidor Python.
3. Esperar 5 segundos a que la gráfica cargue.
4. Arrancar Node.js en la ventana principal.
