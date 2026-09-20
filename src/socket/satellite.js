import { askAtlas } from '../ai/qwen.js';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Instancia global de Edge TTS con caché de modelo para evitar reconexiones repetitivas
const tts = new MsEdgeTTS();
let activeVoiceModel = null;

// Precalentar la conexión TTS al iniciar
tts.setMetadata('es-ES-AlvaroNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { voiceLocale: 'es-ES' })
    .then(() => { activeVoiceModel = 'es-ES-AlvaroNeural'; })
    .catch(err => console.warn('[TTS] Aviso precalentando Edge TTS:', err.message));

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
                    
                    const response = await askAtlas(textTranscription, conversationHistory, username);
                    
                    conversationHistory.push({ role: 'assistant', content: response.text });
                    if (conversationHistory.length > 20) conversationHistory.splice(0, 2);

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
                sendSatelliteState(ws, 'IDLE', 'sleeping');
            } else if (data.event === 'TEXT_COMMAND' && data.text) {
                const username = data.identity || 'invitado';
                console.log(`[Web Simulator] Comando: "${data.text}", Voz: ${data.voice}, Usuario: ${username}`);
                sendSatelliteState(ws, 'THINKING', 'pulsing_blue');

                const response = await askAtlas(data.text, conversationHistory, username);
                
                // Guardamos el historial del asistente
                conversationHistory.push({ role: 'assistant', content: response.text });
                if (conversationHistory.length > 20) conversationHistory.splice(0, 2);

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
 * Función que genera el audio usando Edge TTS dinámicamente y lo envía al cliente.
 */
async function sendVoiceResponse(ws, text, voicePreference = 'male') {
    try {
        const voiceModel = voicePreference === 'female' ? 'es-ES-ElviraNeural' : 'es-ES-AlvaroNeural';
        
        // Solo configurar metadatos si cambia el modelo de voz (ahorra 350-500ms de latencia)
        if (activeVoiceModel !== voiceModel) {
            console.log(`[TTS] ☁️ Cambiando modelo de voz a: ${voiceModel}`);
            await tts.setMetadata(voiceModel, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { voiceLocale: 'es-ES' });
            activeVoiceModel = voiceModel;
        }

        // Escapar caracteres XML para evitar que rompan el SSML interno de Edge TTS
        const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const { audioStream } = tts.toStream(safeText);
        
        const chunks = [];
        audioStream.on('data', chunk => chunks.push(chunk));
        
        audioStream.on('close', () => {
            const audioBuffer = Buffer.concat(chunks);
            console.log(`[TTS] ✅ Audio generado (${voiceModel}) - ${audioBuffer.length} bytes.`);
            
            // Enviar texto, estado HABLANDO y audio binario sincronizados exactamente al mismo tiempo
            if (ws.readyState === ws.OPEN) {
                sendSatelliteState(ws, 'SPEAKING', 'waveform');
                ws.send(JSON.stringify({ type: 'text_response', text: text }));
                ws.send(audioBuffer, { binary: true });
                console.log(`[Satellite] 🔊 Audio y texto sincronizados enviados (${audioBuffer.length} bytes)`);
                
                // Si Atlas se está despidiendo, cerramos la ventana de conversación.
                const isFarewell = /adiós|hasta luego|nos vemos|que descanses|hasta pronto/i.test(text);
                
                if (isFarewell) {
                    console.log("[Satellite] Despedida detectada. Cerrando micro.");
                    setTimeout(() => sendSatelliteState(ws, 'IDLE', 'sleeping'), 2000);
                } else {
                    // MODO CONVERSACION CONTINUA: Se envia la senal para que el cliente abra el micro AL TERMINAR el audio
                    ws.send(JSON.stringify({ event: 'OPEN_MIC' }));
                }
            }
        });

        audioStream.on('error', (err) => {
            console.error('[TTS] Error en el stream de audio:', err);
            // Si falla el audio, al menos mostramos el texto
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'text_response', text: text }));
            }
            setTimeout(() => sendSatelliteState(ws, 'IDLE', 'sleeping'), 2000);
        });

    } catch (e) {
        console.error('[TTS] Error fatal generando voz:', e.message);
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'text_response', text: text }));
        }
        setTimeout(() => sendSatelliteState(ws, 'IDLE', 'sleeping'), 2000);
    }
}
