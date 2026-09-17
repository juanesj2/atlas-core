import { askAtlas } from '../ai/qwen.js';
import * as googleTTS from 'google-tts-api';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';

const execPromise = util.promisify(exec);

/**
 * Función helper para enviar estados visuales y animaciones al satélite.
 * @param {WebSocket} ws - Instancia de WebSocket activa.
 * @param {"IDLE"|"LISTENING"|"THINKING"|"SPEAKING"} state - Estado del sistema.
 * @param {string} animation - Nombre de la animación para la pantalla LCD.
 */
const sendSatelliteState = (ws, state, animation = 'default') => {
    if (ws.readyState === ws.OPEN) {
        const payload = JSON.stringify({ state, animation });
        ws.send(payload);
        console.log(`[Satellite] State updated -> ${state} (${animation})`);
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
 * Función que genera el audio TTS (Piper o Google) y lo envía junto con el texto a la pantalla/web
 */
async function sendVoiceResponse(ws, text) {
    sendSatelliteState(ws, 'SPEAKING', 'waveform');
    
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'text_response', text: text }));
    }

    try {
        const piperDir = path.join(process.cwd(), 'piper_tts');
        const piperBin = path.join(piperDir, 'piper');
        const piperModel = path.join(piperDir, 'voice.onnx');
        const outputWav = path.join(process.cwd(), 'temp_tts.wav');

        let audioBuffer;

        // Si PiperTTS está instalado localmente, lo usamos (Latencia 0)
        if (fs.existsSync(piperBin)) {
            console.log(`[TTS] ⚡ Usando PiperTTS Local para: "${text.substring(0,30)}..."`);
            const safeText = text.replace(/"/g, '\\"');
            await execPromise(`echo "${safeText}" | ${piperBin} --model ${piperModel} --output_file ${outputWav}`);
            audioBuffer = fs.readFileSync(outputWav);
            fs.unlinkSync(outputWav); // Limpiar
        } 
        // Si no está instalado, usamos Google como Fallback
        else {
            console.log(`[TTS] ☁️ Usando Google TTS Fallback para: "${text.substring(0,30)}..."`);
            const url = googleTTS.getAudioUrl(text, { lang: 'es', slow: false, host: 'https://translate.google.com' });
            const audioRes = await fetch(url);
            audioBuffer = await audioRes.arrayBuffer();
        }

        // Enviar binario (Música/Voz) al cliente
        if (ws.readyState === ws.OPEN) {
            ws.send(audioBuffer, { binary: true });
        }
    } catch (e) {
        console.error('[TTS] Error generando voz:', e.message);
    }

    setTimeout(() => sendSatelliteState(ws, 'IDLE', 'sleeping'), 5000);
}
