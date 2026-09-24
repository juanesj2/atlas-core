import { askCronos } from '../ai/qwen.js';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execFile, spawn } from 'child_process';
import { logInteraction } from '../ai/interactionLogger.js';
import { runLearningCycle } from '../ai/autoLearner.js';

let autoLearnTimer = null;
const scheduleAutoLearning = (delayMs = 45000) => {
    clearTimeout(autoLearnTimer);
    autoLearnTimer = setTimeout(async () => {
        try {
            await runLearningCycle();
        } catch (e) {
            console.error('[AutoLearner] Error en tarea diferida:', e);
        }
    }, delayMs);
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════
// 🔊 SISTEMA TTS DUAL: Piper (local, primario) + Edge TTS (fallback)
// ═══════════════════════════════════════════════════════════════

// Piper TTS (LOCAL) — Motor principal: instantáneo, sin dependencia de internet
const PIPER_DIR = path.resolve(__dirname, '../../piper_tts');
const PIPER_BIN = path.join(PIPER_DIR, 'piper');
const PIPER_MODEL = path.join(PIPER_DIR, 'voice.onnx');
const PIPER_SAMPLE_RATE = 22050; // Configurado en voice.onnx.json
const PIPER_AVAILABLE = fs.existsSync(PIPER_BIN) && fs.existsSync(PIPER_MODEL);

if (PIPER_AVAILABLE) {
    console.log('[TTS] 🟢 Piper TTS local detectado. Motor primario ACTIVO.');
} else {
    console.warn('[TTS] ⚠️ Piper TTS no encontrado. Usando Edge TTS como motor principal.');
}

/**
 * Sintetiza texto a WAV usando Piper TTS local.
 * Devuelve un Buffer con el archivo WAV completo, o null si falla.
 */
function piperSynthesize(text) {
    return new Promise((resolve) => {
        const env = { ...process.env, LD_LIBRARY_PATH: PIPER_DIR };
        const child = spawn(PIPER_BIN, [
            '--model', PIPER_MODEL,
            '--output-raw'
        ], { env, timeout: 8000 });

        // Recoger datos binarios RAW directamente como Buffers (NO como texto UTF-8)
        const chunks = [];
        child.stdout.on('data', chunk => chunks.push(chunk));
        child.stderr.on('data', () => {}); // ignorar stderr (logs de piper)

        child.on('error', (err) => {
            console.error('[TTS/Piper] Error de proceso:', err.message);
            resolve(null);
        });

        child.on('close', (code) => {
            if (code !== 0) {
                console.error(`[TTS/Piper] Proceso terminó con código ${code}`);
                return resolve(null);
            }
            // PCM raw: 16-bit signed LE, mono, 22050 Hz
            const pcmData = Buffer.concat(chunks);
            if (pcmData.length < 100) {
                console.warn('[TTS/Piper] Audio demasiado corto, descartando.');
                return resolve(null);
            }
            // Construir cabecera WAV manualmente
            const wavHeader = Buffer.alloc(44);
            const dataLen = pcmData.length;
            const fileLen = dataLen + 36;
            wavHeader.write('RIFF', 0);
            wavHeader.writeUInt32LE(fileLen, 4);
            wavHeader.write('WAVE', 8);
            wavHeader.write('fmt ', 12);
            wavHeader.writeUInt32LE(16, 16);      // fmt chunk size
            wavHeader.writeUInt16LE(1, 20);        // PCM format
            wavHeader.writeUInt16LE(1, 22);        // mono
            wavHeader.writeUInt32LE(PIPER_SAMPLE_RATE, 24); // sample rate
            wavHeader.writeUInt32LE(PIPER_SAMPLE_RATE * 2, 28); // byte rate
            wavHeader.writeUInt16LE(2, 32);        // block align
            wavHeader.writeUInt16LE(16, 34);       // bits per sample
            wavHeader.write('data', 36);
            wavHeader.writeUInt32LE(dataLen, 40);
            resolve(Buffer.concat([wavHeader, pcmData]));
        });

        // Enviar el texto por stdin
        child.stdin.write(text);
        child.stdin.end();
    });
}

// Edge TTS (NUBE) — Motor de respaldo si Piper no está disponible
let tts = new MsEdgeTTS();
let activeVoiceModel = null;

// Solo precalentar Edge TTS si Piper NO está disponible (ahorra recursos)
if (!PIPER_AVAILABLE) {
    tts.setMetadata('es-ES-AlvaroNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { voiceLocale: 'es-ES' })
        .then(() => { activeVoiceModel = 'es-ES-AlvaroNeural'; })
        .catch(err => console.warn('[TTS] Aviso precalentando Edge TTS:', err.message));
}

// Registro de satélites conectados para emitir mensajes proactivos
const connectedSatellites = new Set();

/**
 * Función helper para enviar estados visuales y animaciones al satélite.
 */
const sendSatelliteState = (ws, state, animation = 'default') => {
    if (ws.readyState === ws.OPEN) {
        const payload = JSON.stringify({ state, animation });
        ws.send(payload);
    }
};

/**
 * Emite un mensaje de voz a todos los satélites conectados (Proactividad).
 */
export const broadcastVoiceMessage = async (text, voiceType = 'male') => {
    console.log(`[Broadcast] Enviando mensaje proactivo a ${connectedSatellites.size} satélites...`);
    for (const ws of connectedSatellites) {
        if (ws.readyState === ws.OPEN) {
            await sendVoiceResponse(ws, text, voiceType);
        }
    }
};

/**
 * Gestiona el ciclo de vida y los mensajes de un WebSocket conectado (ESP32).
 * @param {WebSocket} ws 
 * @param {http.IncomingMessage} req 
 */
export const handleSatelliteConnection = (ws, req) => {
    const clientIp = req ? req.socket.remoteAddress : 'unknown';
    console.log(`[Satellite] 🛰️ Nueva conexión desde: ${clientIp}`);
    
    connectedSatellites.add(ws);

    ws.on('close', () => {
        console.log(`[Satellite] ❌ Satélite desconectado: ${clientIp}`);
        connectedSatellites.delete(ws);
    });

    // Historial a corto plazo para esta sesión
    let conversationHistory = [];

    // Enviar estado inicial
    sendSatelliteState(ws, 'IDLE', 'sleeping');

    ws.on('message', async (message, isBinary) => {
        try {
            if (isBinary) {
                console.log(`[Satellite] 🎙️ Recibidos ${message.length} bytes de audio.`);
                sendSatelliteState(ws, 'THINKING', 'pulsing_blue');

                // Guardar el buffer en un archivo temporal
                const tempAudioPath = path.join(__dirname, '../../temp_incoming.wav');
                fs.writeFileSync(tempAudioPath, message);

                const profilesDir = path.join(__dirname, '../../voice_profiles');
                const scriptPath = path.join(__dirname, '../biometrics/audio_pipeline.py');
                
                // Llamar al microservicio de Python en caliente
                console.log(`[Satellite] 🧠 Procesando audio en caliente (Python)...`);
                
                try {
                    const pyRes = await fetch('http://127.0.0.1:8000/process_audio', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filepath: tempAudioPath })
                    });
                    
                    if (!pyRes.ok) throw new Error(`HTTP error! status: ${pyRes.status}`);
                    
                    const result = await pyRes.json();
                    const username = result.user || 'invitado';
                    const textTranscription = result.text || '';
                    
                    console.log(`[Satellite] 👤 Usuario: ${username}`);
                    console.log(`[Satellite] 📝 Texto: ${textTranscription}`);
                    
                    if (!textTranscription || textTranscription.length <= 2) {
                        console.log(`[Satellite] ⚠️ Audio demasiado corto o incomprensible.`);
                        sendSatelliteState(ws, 'IDLE', 'sleeping');
                        return;
                    }
                    
                    const response = await askCronos(textTranscription, conversationHistory, username);
                    
                    // Si el usuario pidió registrar su voz desde un satélite físico (ESP32):
                    const isEnroll = response.toolCall && response.toolCall.some(t => t.action === 'register_voice_profile');
                    if (isEnroll && fs.existsSync(tempAudioPath)) {
                        const voiceProfilesDir = path.join(__dirname, '../../voice_profiles');
                        if (!fs.existsSync(voiceProfilesDir)) fs.mkdirSync(voiceProfilesDir, { recursive: true });
                        const enrollTarget = path.join(voiceProfilesDir, 'juanes.wav');
                        fs.copyFileSync(tempAudioPath, enrollTarget);
                        console.log(`[Satellite] 🧬 Perfil biométrico guardado directamente desde satélite en ${enrollTarget}`);
                    }

                    conversationHistory.push({ role: 'assistant', content: response.text });
                    if (conversationHistory.length > 20) conversationHistory.splice(0, 2);

                    // Registrar interacción para el motor de autoaprendizaje
                    logInteraction({
                        username,
                        prompt: textTranscription,
                        response: response.text,
                        toolsUsed: (response.toolCall || []).map(t => t.action),
                        isVoice: true
                    });
                    scheduleAutoLearning();

                    await sendVoiceResponse(ws, response.text, 'male');
                    
                } catch (e) {
                    console.error('[Satellite] Error procesando audio con la API de Python:', e.message);
                } finally {
                    // Limpieza garantizada
                    if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
                }
                
                return;
            }

            const data = JSON.parse(message.toString());
            console.log('[Satellite] Mensaje JSON recibido:', data);

            if (data.event === 'WAKE_WORD_DETECTED') {
                sendSatelliteState(ws, 'LISTENING', 'mic_active');
            } else if (data.event === 'STOP_SPEAKING') {
                console.log('[Satellite] 🛑 STOP_SPEAKING recibido. Volviendo a IDLE.');
                ws.isInterrupted = true;
                sendSatelliteState(ws, 'IDLE', 'sleeping');
            } else if (data.event === 'TEXT_COMMAND' && data.text) {
                const username = data.identity || 'invitado';
                
                // Inject default Spotify device if configured in the frontend
                if (data.spotify_device && !/en el|en la|en mi|en spotify/i.test(data.text)) {
                    const isMusicIntent = /(?:puedes\s+)?(?:pon(?:me)?|poner(?:me)?|quiero\s+(?:escuchar\s+)?|reproduce|toca|inicia|escuchar)\s+(?:algo\s+de\s+|un\s+poco\s+de\s+)?(?:m[uú]sica|canci[oó]n|canci[oó]nes|spotify)|^pon\s+|\b(?:en\s+)?spotify\b|^(para|pausa|det[eé]n|quita|apaga|siguiente|pasa|otra|anterior|retrocede|vuelve|reanuda|sigue con|dale al play|contin[uú]a|qu[eé]\s+canci[oó]n\s+es|qu[eé]\s+suena|qu[eé]\s+est[aá]\s+sonando|qui[eé]n\s+canta|c[oó]mo\s+se\s+llama|pon\s+el\s+volumen|sube\s+el\s+volumen|baja\s+el\s+volumen|volumen\s+al)/i.test(data.text);
                    if (isMusicIntent) {
                        data.text = `${data.text} en el ${data.spotify_device}`;
                    }
                }

                console.log(`[Web Simulator] Comando: "${data.text}", Voz: ${data.voice}, Usuario: ${username}`);
                ws.isInterrupted = false;
                sendSatelliteState(ws, 'THINKING', 'pulsing_blue');

                const response = await askCronos(data.text, conversationHistory, username, data.device_location);
                
                if (ws.isInterrupted) {
                    console.log('[Satellite] 🛑 Respuesta cancelada por interrupción del usuario.');
                    return;
                }

                // Limitar tamaño del historial para no saturar el contexto
                if (conversationHistory.length > 20) conversationHistory.splice(0, 2);

                // Registrar interacción para el motor de autoaprendizaje
                logInteraction({
                    username,
                    prompt: data.text,
                    response: response.text,
                    toolsUsed: (response.toolCall || []).map(t => t.action),
                    isVoice: data.isSpoken !== false
                });
                scheduleAutoLearning();

                // Si la herramienta register_voice_profile fue invocada por la IA:
                const hasVoiceEnrollment = response.toolCall && response.toolCall.some(t => t.action === 'register_voice_profile');
                if (hasVoiceEnrollment && ws.readyState === ws.OPEN) {
                    const targetUser = username !== 'invitado' ? username : 'Juanes';
                    console.log(`[Satellite] 🎙️ Disparando evento TRIGGER_VOICE_ENROLLMENT para: ${targetUser}`);
                    ws.send(JSON.stringify({ 
                        event: 'TRIGGER_VOICE_ENROLLMENT', 
                        username: targetUser 
                    }));
                }

                if (data.isSpoken !== false) {
                    await sendVoiceResponse(ws, response.text, data.voice);
                } else {
                    sendSatelliteState(ws, 'IDLE', 'sleeping');
                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({ type: 'text_response', text: response.text }));
                    }
                }
            }

        } catch (error) {
            console.error('[Satellite] Error procesando mensaje:', error);
        }
    });

    ws.on('close', () => {
        console.log(`[Satellite] 🔴 Desconectado: ${clientIp}`);
    });

    ws.on('error', (error) => {
        console.error(`[Satellite] ❌ Error en WebSocket:`, error);
    });
};

/**
 * Función que genera audio de voz y lo envía al cliente.
 * Prioridad: Piper TTS (local, instantáneo) → Edge TTS (nube, fallback)
 */
async function sendVoiceResponse(ws, text, voicePreference = 'male') {
    // Sanitizar el texto: evitar que Cronos pronuncie su propio wake word
    const safeText = text
        .replace(/\bsoy\s+Cronos\b/gi, 'Soy tu asistente')
        .replace(/\bCronos\b/gi, 'tu asistente');

    // ── INTENTO 1: Piper TTS (local) ──
    if (PIPER_AVAILABLE) {
        try {
            const startTime = Date.now();
            const wavBuffer = await piperSynthesize(safeText);
            
            if (wavBuffer && wavBuffer.length > 100) {
                const elapsed = Date.now() - startTime;
                console.log(`[TTS/Piper] ✅ Audio generado en ${elapsed}ms (${wavBuffer.length} bytes)`);
                return deliverAudioResponse(ws, text, wavBuffer);
            }
            console.warn('[TTS/Piper] ⚠️ Piper no generó audio válido. Intentando Edge TTS...');
        } catch (e) {
            console.error('[TTS/Piper] Error:', e.message, '→ Fallback a Edge TTS');
        }
    }

    // ── INTENTO 2: Edge TTS (nube) ──
    try {
        const voiceModel = voicePreference === 'female' ? 'es-ES-ElviraNeural' : 'es-ES-AlvaroNeural';
        
        if (activeVoiceModel !== voiceModel) {
            console.log(`[TTS/Edge] ☁️ Cambiando modelo de voz a: ${voiceModel}`);
            await tts.setMetadata(voiceModel, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { voiceLocale: 'es-ES' });
            activeVoiceModel = voiceModel;
        }

        // Escapar XML para Edge TTS (SSML interno)
        const edgeSafeText = safeText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        let responseSent = false;
        const fallbackTimer = setTimeout(() => {
            if (responseSent) return;
            responseSent = true;
            console.warn('[TTS/Edge] ⏱️ Timeout (3.5s). Enviando solo texto.');
            try { tts = new MsEdgeTTS(); activeVoiceModel = null; } catch (e) {}
            deliverTextOnlyResponse(ws, text);
        }, 3500);

        const { audioStream } = tts.toStream(edgeSafeText);
        
        const chunks = [];
        audioStream.on('data', chunk => chunks.push(chunk));
        
        audioStream.on('close', () => {
            clearTimeout(fallbackTimer);
            if (responseSent) return;
            responseSent = true;

            const audioBuffer = Buffer.concat(chunks);
            if (audioBuffer.length > 0) {
                console.log(`[TTS/Edge] ✅ Audio generado (${voiceModel}) - ${audioBuffer.length} bytes.`);
                deliverAudioResponse(ws, text, audioBuffer);
            } else {
                console.warn('[TTS/Edge] ⚠️ Audio vacío.');
                deliverTextOnlyResponse(ws, text);
            }
        });

        audioStream.on('error', (err) => {
            clearTimeout(fallbackTimer);
            console.error('[TTS/Edge] Error stream:', err.message);
            try { tts = new MsEdgeTTS(); activeVoiceModel = null; } catch (e) {}
            if (responseSent) return;
            responseSent = true;
            deliverTextOnlyResponse(ws, text);
        });

    } catch (e) {
        console.error('[TTS] Error fatal generando voz:', e.message);
        try { tts = new MsEdgeTTS(); activeVoiceModel = null; } catch (err) {}
        deliverTextOnlyResponse(ws, text);
    }
}

/**
 * Envía audio + texto al cliente y gestiona OPEN_MIC / IDLE.
 */
function deliverAudioResponse(ws, text, audioBuffer) {
    if (ws.readyState !== ws.OPEN) return;
    sendSatelliteState(ws, 'SPEAKING', 'waveform');
    ws.send(JSON.stringify({ type: 'text_response', text: text }));
    ws.send(audioBuffer, { binary: true });
    console.log(`[Satellite] 🔊 Audio y texto enviados (${audioBuffer.length} bytes)`);
    handlePostResponse(ws, text);
}

/**
 * Envía solo texto (sin audio) cuando TTS falla completamente.
 */
function deliverTextOnlyResponse(ws, text) {
    if (ws.readyState !== ws.OPEN) return;
    sendSatelliteState(ws, 'IDLE', 'sleeping');
    ws.send(JSON.stringify({ type: 'text_response', text: text }));
    handlePostResponse(ws, text);
}

/**
 * Lógica post-respuesta: OPEN_MIC si pregunta, IDLE si no.
 */
function handlePostResponse(ws, text) {
    if (ws.readyState !== ws.OPEN) return;
    const isQuestion = /[?¿]/.test(text) && !/adiós|hasta luego|nos vemos|que descanses|hasta pronto/i.test(text);
    
    if (isQuestion) {
        console.log("[Satellite] ❓ Pregunta detectada. Habilitando micro temporal (OPEN_MIC).");
        ws.send(JSON.stringify({ event: 'OPEN_MIC' }));
    } else {
        console.log("[Satellite] 💤 Respuesta informativa. Volviendo a IDLE.");
        sendSatelliteState(ws, 'IDLE', 'sleeping');
    }
}
