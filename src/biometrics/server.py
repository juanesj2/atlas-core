import os
import time
from fastapi import FastAPI
from pydantic import BaseModel
from speechbrain.inference.speaker import SpeakerRecognition
from faster_whisper import WhisperModel

app = FastAPI(title="Atlas Audio Engine")

print("=========================================")
print("🚀 Cargando modelos de IA en VRAM...")
print("=========================================")

start_time = time.time()
# Cargar modelos una sola vez al iniciar el servidor
verification = SpeakerRecognition.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb", 
    savedir="tmpdir"
)

# Cambiar a device="cpu" si no hay GPU en pruebas, pero en la torre usar "cuda"
whisper_model = WhisperModel("base", device="cuda", compute_type="float16")
print(f"✅ Modelos cargados en {round(time.time() - start_time, 2)} segundos.")
print("🎧 Servidor de audio listo y esperando en el puerto 8000...")
print("=========================================")

PROFILES_DIR = os.path.join(os.path.dirname(__file__), '../../voice_profiles')

class AudioRequest(BaseModel):
    filepath: str

@app.post("/process_audio")
async def process_audio(req: AudioRequest):
    tmp_path = req.filepath

    # 1. BIOMETRÍA (Verificación de Voz)
    best_match = "Desconocido"
    best_score = 0.5  # Umbral mínimo de confianza

    if os.path.exists(PROFILES_DIR):
        for profile in os.listdir(PROFILES_DIR):
            if profile.endswith(".wav"):
                profile_path = os.path.join(PROFILES_DIR, profile)
                try:
                    score, prediction = verification.verify_files(tmp_path, profile_path)
                    if prediction.item() and score.item() > best_score:
                        # Limpiar nombre (ej: juanes_creador.wav -> Juanes Creador)
                        best_match = profile.replace(".wav", "").replace("_", " ").title()
                        best_score = score.item()
                except Exception as e:
                    print(f"[Error Biometría] {e}")

    # 2. TRANSCRIPCIÓN (STT)
    text = ""
    try:
        segments, _ = whisper_model.transcribe(tmp_path, beam_size=5, language="es")
        text = " ".join([segment.text for segment in segments]).strip()
    except Exception as e:
        print(f"[Error STT] {e}")

    return {"user": best_match, "text": text}
