import os
import time
import torch
from fastapi import FastAPI
from pydantic import BaseModel
from speechbrain.inference.speaker import SpeakerRecognition
from faster_whisper import WhisperModel

app = FastAPI(title="Atlas Audio Engine")

print("=========================================")
print("🚀 Iniciando Motor Biométrico de Atlas...")
print("=========================================")

start_time = time.time()
device = "cuda" if torch.cuda.is_available() else "cpu"
compute_type = "float16" if device == "cuda" else "int8"
print(f"🖥️ Dispositivo de cálculo: {device.upper()} (Compute: {compute_type})")

# 1. Cargar modelo biométrico SpeechBrain ECAPA-TDNN
model_dir = os.path.join(os.path.dirname(__file__), "model_cache")
os.makedirs(model_dir, exist_ok=True)

verification = SpeakerRecognition.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb", 
    savedir=os.path.join(model_dir, "spkrec-ecapa-voxceleb"),
    run_opts={"device": device}
)

# 2. Cargar Faster-Whisper
whisper_model = WhisperModel("base", device=device, compute_type=compute_type)

print(f"✅ Modelos de IA cargados con éxito en {round(time.time() - start_time, 2)}s.")
print("🎧 Microservicio de Biometría listo en http://127.0.0.1:8000")
print("=========================================")

PROFILES_DIR = os.path.join(os.path.dirname(__file__), '../../voice_profiles')

class AudioRequest(BaseModel):
    filepath: str

@app.get("/health")
async def health():
    profiles = []
    if os.path.exists(PROFILES_DIR):
        profiles = [p.replace(".wav", "").replace("_", " ").title() for p in os.listdir(PROFILES_DIR) if p.endswith(".wav")]
    return {
        "status": "online",
        "device": device,
        "gpu_available": torch.cuda.is_available(),
        "profiles_count": len(profiles),
        "profiles": profiles
    }

@app.post("/process_audio")
async def process_audio(req: AudioRequest):
    tmp_path = req.filepath

    # 1. BIOMETRÍA (Verificación de Voz con SpeechBrain)
    best_match = "invitado"
    threshold = 0.28  # Umbral óptimo de verificación de locutor
    highest_score = 0.0

    if os.path.exists(PROFILES_DIR) and os.path.exists(tmp_path):
        for profile in os.listdir(PROFILES_DIR):
            if profile.endswith((".wav", ".mp3", ".flac", ".ogg")):
                profile_path = os.path.join(PROFILES_DIR, profile)
                try:
                    score, prediction = verification.verify_files(tmp_path, profile_path)
                    sim = score.item()
                    if sim > highest_score and sim > threshold:
                        highest_score = sim
                        raw_name = os.path.splitext(profile)[0].replace("_", " ")
                        best_match = raw_name.title()
                except Exception as e:
                    print(f"[Error Biometría con {profile}]: {e}")

    # 2. TRANSCRIPCIÓN (STT con Faster-Whisper)
    text = ""
    if os.path.exists(tmp_path):
        try:
            segments, _ = whisper_model.transcribe(tmp_path, beam_size=5, language="es")
            text = " ".join([segment.text for segment in segments]).strip()
        except Exception as e:
            print(f"[Error STT]: {e}")

    print(f"[Biometrics] 🔍 Identificado: {best_match} (Similitud: {round(highest_score, 3)}) | Texto: \"{text}\"")

    return {
        "user": best_match,
        "score": round(highest_score, 3),
        "text": text
    }
