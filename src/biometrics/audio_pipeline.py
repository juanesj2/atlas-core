import sys
import os
import json
import warnings
import logging

# Suprimir warnings
warnings.filterwarnings("ignore")
logging.getLogger("speechbrain").setLevel(logging.ERROR)
logging.getLogger("faster_whisper").setLevel(logging.ERROR)

try:
    import torch
    from speechbrain.inference.speaker import SpeakerRecognition
    from faster_whisper import WhisperModel
except ImportError:
    print(json.dumps({"error": "missing_dependencies"}))
    sys.exit(1)

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "invalid_args"}))
        return

    target_audio = sys.argv[1]
    profiles_dir = sys.argv[2]

    if not os.path.exists(target_audio):
        print(json.dumps({"error": "file_not_found"}))
        return

    # Configuramos el dispositivo (GPU si hay, si no CPU)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"

    # --- 1. BIOMETRÍA (SpeechBrain) ---
    best_match = "invitado"
    try:
        verification = SpeakerRecognition.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb", 
            savedir="pretrained_models/spkrec-ecapa-voxceleb",
            run_opts={"device": device}
        )
        
        highest_score = 0.0
        threshold = 0.25 

        if os.path.exists(profiles_dir):
            for file in os.listdir(profiles_dir):
                if file.endswith((".wav", ".mp3", ".flac", ".ogg")):
                    profile_path = os.path.join(profiles_dir, file)
                    score, prediction = verification.verify_files(target_audio, profile_path)
                    similarity = score.item()
                    
                    if similarity > highest_score and similarity > threshold:
                        highest_score = similarity
                        best_match = os.path.splitext(file)[0]
        
        best_match = best_match.strip().lower()
    except Exception as e:
        best_match = "invitado"

    # --- 2. TRANSCRIPCIÓN STT (Faster-Whisper) ---
    transcription = ""
    try:
        # Usamos el modelo 'base' para mayor velocidad. En la torre con la 3060Ti se puede subir a 'small' o 'medium'
        model = WhisperModel("base", device=device, compute_type=compute_type)
        segments, info = model.transcribe(target_audio, beam_size=5, language="es")
        
        text_parts = []
        for segment in segments:
            text_parts.append(segment.text)
        transcription = " ".join(text_parts).strip()
    except Exception as e:
        transcription = ""

    # --- 3. SALIDA UNIFICADA (JSON) ---
    result = {
        "user": best_match,
        "text": transcription
    }
    
    print(json.dumps(result))

if __name__ == "__main__":
    main()
