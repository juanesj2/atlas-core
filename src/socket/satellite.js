import { askAtlas } from '../ai/qwen.js';
import { sendCommandToLaravel } from '../bridge/api.js';

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

                // 3. Si la IA decidió ejecutar una herramienta, llamamos a la nube (Laravel)
                if (response.toolCall) {
                    await sendCommandToLaravel(response.toolCall.action, response.toolCall.payload);
                }

                // TODO: En producción, aquí se enviaría response.text a Piper (TTS) para generar audio
                // y se transmitiría el buffer de audio de vuelta por WebSocket al DAC I2S.
                sendSatelliteState(ws, 'SPEAKING', 'waveform');

                // Simulamos que terminó de hablar después de 3 segundos y vuelve a dormir
                setTimeout(() => sendSatelliteState(ws, 'IDLE', 'sleeping'), 3000);
                return;
            }

            // B) Manejo de Eventos JSON (Ej: Wake Word local, telemetría o comandos de texto de la Web)
            const data = JSON.parse(message.toString());
            console.log('[Satellite] Mensaje JSON recibido:', data);

            if (data.event === 'WAKE_WORD_DETECTED') {
                // El ESP32 detectó la palabra de activación (ej: "Hey Atlas")
                sendSatelliteState(ws, 'LISTENING', 'mic_active');
            } else if (data.event === 'TEXT_COMMAND' && data.text) {
                console.log(`[Web Simulator] Comando de texto recibido: "${data.text}"`);
                sendSatelliteState(ws, 'THINKING', 'pulsing_blue');

                // Procesamos el texto con la IA (Ollama / Qwen)
                const response = await askAtlas(data.text);

                // Llamamos a la nube (Laravel) si hay toolCall
                if (response.toolCall) {
                    await sendCommandToLaravel(response.toolCall.action, response.toolCall.payload);
                }

                // Generamos audio (simulado)
                sendSatelliteState(ws, 'SPEAKING', 'waveform');
                
                // Enviar la respuesta de texto a la web para que la muestre en pantalla
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'text_response', text: response.text }));
                }

                setTimeout(() => sendSatelliteState(ws, 'IDLE', 'sleeping'), 3000);
            }


        } catch (error) {
            console.error('[Satellite] Error procesando mensaje:', error);
            sendSatelliteState(ws, 'IDLE', 'error');
        }
    });

    ws.on('close', () => {
        console.log('🔌 Satellite disconnected');
    });

    ws.on('error', (error) => {
        console.error('❌ Satellite WebSocket error:', error);
    });
};
