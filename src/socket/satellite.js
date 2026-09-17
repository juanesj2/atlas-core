import { askAtlas } from '../ai/qwen.js';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Instancia de Edge TTS
const tts = new MsEdgeTTS();
let ttsReady = false;

// Configurar la voz neuronal de Microsoft (Álvaro)
tts.setMetadata('es-ES-AlvaroNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    .then(() => {
        ttsReady = true;
        console.log('[TTS] 🟢 Edge TTS (Álvaro Neural) inicializado correctamente.');
    })
    .catch(err => console.error('[TTS] Error inicializando Edge TTS:', err));

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
 * Gestiona el ciclo de vida y los mensajes de un WebSocket conectado (ESP32).
 * @param {WebSocket} ws 
 * @param {http.IncomingMessage} req 
 */
export const handleSatelliteConnection = (ws, req) => {
    const clientIp = req ? req.socket.remoteAddress : 'unknown';
    console.log(`[Satellite] 🟢 Nueva conexión desde: ${clientIp}`);

    // Enviar estado inicial
    sendSatelliteState(ws, 'IDLE', 'sleeping');

    ws.on('message', async (message, isBinary) => {
        try {
            if (isBinary) {
                console.log(`[Satellite] 🎙️ Recibidos ${message.length} bytes de audio.`);
                sendSatelliteState(ws, 'THINKING', 'pulsing_blue');

                const textTranscription = "¿Qué tiempo hace en Madrid?"; 
                console.log(`[STT] Transcripción simulada: "${textTranscription}"`);
                
                const response = await askAtlas(textTranscription);
                await sendVoiceResponse(ws, response.text);
                return;
            }

            const data = JSON.parse(message.toString());
            console.log('[Satellite] Mensaje JSON recibido:', data);

            if (data.event === 'WAKE_WORD_DETECTED') {
                sendSatelliteState(ws, 'LISTENING', 'mic_active');
            } else if (data.event === 'TEXT_COMMAND' && data.text) {
                console.log(`[Web Simulator] Comando de texto recibido: "${data.text}"`);
                sendSatelliteState(ws, 'THINKING', 'pulsing_blue');

                const response = await askAtlas(data.text);
                await sendVoiceResponse(ws, response.text);
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
 * Función que genera el audio usando Edge TTS y lo envía al cliente.
 */
async function sendVoiceResponse(ws, text) {
    sendSatelliteState(ws, 'SPEAKING', 'waveform');
    
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'text_response', text: text }));
    }

    try {
        if (!ttsReady) {
            console.error('[TTS] Edge TTS no está listo todavía.');
            setTimeout(() => sendSatelliteState(ws, 'IDLE', 'sleeping'), 2000);
            return;
        }

        console.log(`[TTS] ☁️ Generando voz con Edge TTS (Álvaro Neural Modificado para J.A.R.V.I.S)...`);
        
        // Escapar caracteres XML para evitar que rompan el SSML interno de Edge TTS
        const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Obtener el stream de audio con el tono (pitch) rebajado para que suene como J.A.R.V.I.S.
        const { audioStream } = tts.toStream(safeText, { pitch: '-15%', rate: '-5%' });
        
        const chunks = [];
        audioStream.on('data', chunk => chunks.push(chunk));
        
        audioStream.on('close', () => {
            const audioBuffer = Buffer.concat(chunks);
            console.log(`[TTS] ✅ Audio generado con éxito (${audioBuffer.length} bytes).`);
            
            // Enviar el buffer binario por WebSocket al cliente o satélite
            if (ws.readyState === ws.OPEN) {
                ws.send(audioBuffer, { binary: true });
            }
            setTimeout(() => sendSatelliteState(ws, 'IDLE', 'sleeping'), 5000);
        });

        audioStream.on('error', (err) => {
            console.error('[TTS] Error en el stream de audio:', err);
            setTimeout(() => sendSatelliteState(ws, 'IDLE', 'sleeping'), 2000);
        });

    } catch (e) {
        console.error('[TTS] Error fatal generando voz:', e.message);
        setTimeout(() => sendSatelliteState(ws, 'IDLE', 'sleeping'), 2000);
    }
}
