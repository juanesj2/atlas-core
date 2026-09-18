import { askAtlas } from '../ai/qwen.js';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Instancia global de Edge TTS
const tts = new MsEdgeTTS();

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
                
                console.log('[Audio Pipeline] Analizando biometría y transcribiendo con Whisper...');
                
                exec(`python "${scriptPath}" "${tempAudioPath}" "${profilesDir}"`, async (error, stdout, stderr) => {
                    let username = 'invitado';
                    let textTranscription = '';
                    
                    if (!error && stdout) {
                        try {
                            const output = JSON.parse(stdout.trim());
                            if (output.error === 'missing_dependencies') {
                                console.log('[Audio Pipeline] ⚠️ Falta instalar dependencias (torch, speechbrain, faster-whisper).');
                            } else if (output.user && output.text) {
                                username = output.user;
                                textTranscription = output.text;
                            }
                        } catch (e) {
                            console.error('[Audio Pipeline] Error parseando JSON de Python:', stdout);
                        }
                    } else {
                        console.error('[Audio Pipeline] Error ejecutando script:', error || stderr);
                    }

                    console.log(`[STT] 👤 Usuario: ${username} | 📝 Texto: "${textTranscription}"`);

                    if (!textTranscription) {
                        console.log('[STT] Audio vacío o ininteligible. Ignorando.');
                        sendSatelliteState(ws, 'IDLE', 'sleeping');
                        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
                        return;
                    }
                    
                    const response = await askAtlas(textTranscription, conversationHistory, username);
                    
                    conversationHistory.push({ role: 'assistant', content: response.text });
                    if (conversationHistory.length > 20) conversationHistory.splice(0, 2);

                    await sendVoiceResponse(ws, response.text, 'male');
                    
                    // Limpieza
                    if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
                });
                return;
            }

            const data = JSON.parse(message.toString());
            console.log('[Satellite] Mensaje JSON recibido:', data);

            if (data.event === 'WAKE_WORD_DETECTED') {
                sendSatelliteState(ws, 'LISTENING', 'mic_active');
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
    sendSatelliteState(ws, 'SPEAKING', 'waveform');
    
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'text_response', text: text }));
    }

    try {
        // Seleccionar el modelo de voz de Microsoft según la preferencia
        const voiceModel = voicePreference === 'female' ? 'es-ES-ElviraNeural' : 'es-ES-AlvaroNeural';
        
        console.log(`[TTS] ☁️ Configurando modelo de voz a: ${voiceModel}`);
        await tts.setMetadata(voiceModel, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { voiceLocale: 'es-ES' });

        // Escapar caracteres XML para evitar que rompan el SSML interno de Edge TTS
        const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const { audioStream } = tts.toStream(safeText);
        
        const chunks = [];
        audioStream.on('data', chunk => chunks.push(chunk));
        
        audioStream.on('close', () => {
            const audioBuffer = Buffer.concat(chunks);
            console.log(`[TTS] ✅ Audio generado (${voiceModel}) - ${audioBuffer.length} bytes.`);
            
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
