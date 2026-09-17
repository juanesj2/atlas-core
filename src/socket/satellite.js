import { askAtlas } from '../ai/qwen.js';
import * as googleTTS from 'google-tts-api';

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
 */
export const handleSatelliteConnection = (ws) => {
    // 1. Al conectar, enviamos el estado inactivo al satélite
    sendSatelliteState(ws, 'IDLE', 'sleeping');

    ws.on('message', async (message, isBinary) => {
        try {
            // A) Manejo de Stream Binario (Ej: Audio capturado por el micrófono I2S)
            if (isBinary) {
                console.log(`[Satellite] Recibidos ${message.length} bytes de audio binario.`);
                
                // Animación visual de pensamiento mientras procesamos
                sendSatelliteState(ws, 'THINKING', 'pulsing_blue');

                // TODO: En producción, aquí se enviaría el buffer a Faster-Whisper (STT)
                // Para el flujo actual, simulamos una transcripción fija:
                const transcribedText = "Guarda una nota secreta que diga comprar pan";
                console.log(`[STT Simulado] Usuario dijo: "${transcribedText}"`);

                // 2. Pasamos el texto transcrito a la IA (Ollama / Qwen)
                const response = await askAtlas(transcribedText);
                // ==========================================
                // FLUJO DE ENTRADA DE AUDIO (Micrófono)
                // ==========================================
                console.log(`[Satellite] 🎙️ Recibidos ${message.length} bytes de audio.`);
                sendSatelliteState(ws, 'THINKING', 'pulsing_blue');

                // Aquí conectaríamos con Faster-Whisper localmente.
                // Simulamos que Whisper ha transcrito el audio:
                const textTranscription = "¿Qué tiempo hace en Madrid?"; 
                console.log(`[STT] Transcripción simulada: "${textTranscription}"`);
                
                // Procesar con la IA
                const response = await askAtlas(textTranscription);
                await sendVoiceResponse(ws, response.text);

                return;
            }

            // ==========================================
            // FLUJO DE EVENTOS JSON (Texto de la web)
            // ==========================================
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
        console.error('❌ Satellite WebSocket error:', error);
    });
};

/**
 * Función que genera el audio TTS y lo envía junto con el texto a la pantalla/web
 */
async function sendVoiceResponse(ws, text) {
    // 1. Enviar estado visual a la pantalla
    sendSatelliteState(ws, 'SPEAKING', 'waveform');
    
    if (ws.readyState === ws.OPEN) {
        // Enviar la respuesta textual para la UI
        ws.send(JSON.stringify({ type: 'text_response', text: text }));
    }

    try {
        // 2. Generar Voz con Google TTS (Provisional hasta poner PiperTTS)
        console.log(`[TTS] Generando audio para: "${text.substring(0,30)}..."`);
        const url = googleTTS.getAudioUrl(text, { lang: 'es', slow: false, host: 'https://translate.google.com' });
        
        // Descargamos el buffer de audio (MP3)
        const audioRes = await fetch(url);
        const arrayBuffer = await audioRes.arrayBuffer();
        
        // 3. Enviar binario (Música/Voz) al cliente
        if (ws.readyState === ws.OPEN) {
            ws.send(arrayBuffer, { binary: true });
        }
    } catch (e) {
        console.error('[TTS] Error generando voz:', e.message);
    }

    // 4. Volver a dormir
    setTimeout(() => sendSatelliteState(ws, 'IDLE', 'sleeping'), 5000);
}

function sendSatelliteState(ws, state, animation) {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ state, animation }));
    }
}
