import ollama from 'ollama';
import dotenv from 'dotenv';

dotenv.config();

const MOCK_AI = process.env.MOCK_AI === 'true';

const SYSTEM_PROMPT = `Eres Atlas, el asistente virtual de un hogar inteligente.
Tu objetivo es ayudar, controlar dispositivos, o gestionar datos.
Responde de manera concisa, natural y servicial en español.
Si tu respuesta implica realizar una acción, debes generar una llamada a herramienta (tool call) de forma estructurada.`;

/**
 * Procesa la intención del usuario enviando el texto a la IA (Ollama)
 * y evalúa si hay herramientas a invocar.
 * 
 * @param {string} userPrompt - El texto transcrito del usuario.
 * @param {Array} history - Historial de mensajes previos (opcional).
 * @returns {Promise<{text: string, toolCall: object|null}>}
 */
export const askAtlas = async (userPrompt, history = []) => {
    console.log(`[Atlas AI] Evaluando intención para: "${userPrompt}"`);

    // ---------------------------------------------------------
    // MODO SIMULACIÓN (MOCK) - Útil para testing en laptops
    // ---------------------------------------------------------
    if (MOCK_AI) {
        console.log('[Atlas AI] 🟡 Procesando en modo MOCK...');
        
        // Simular un pequeño retardo de inferencia
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Devolvemos una respuesta de prueba (ej. guardando una nota)
        return {
            text: 'He guardado la nota en tu panel. ¿Necesitas algo más?',
            toolCall: {
                action: 'save_secret_note',
                payload: {
                    note: userPrompt,
                    timestamp: new Date().toISOString()
                }
            }
        };
    }

    // ---------------------------------------------------------
    // MODO REAL - Ollama con Qwen 2.5 local
    // ---------------------------------------------------------
    console.log('[Atlas AI] 🟢 Consultando LLM en Ollama...');
    try {
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: userPrompt }
        ];

        // Se conecta por defecto al OLLAMA_HOST configurado en .env
        const response = await ollama.chat({
            model: 'qwen2.5:3b', // O el modelo que estés usando
            messages: messages,
            // Ejemplo de configuración de tools si Qwen está fine-tuned para ello:
            /*
            tools: [{
                type: 'function',
                function: {
                    name: 'save_secret_note',
                    description: 'Guarda una nota de texto en la base de datos de la nube',
                    parameters: {
                        type: 'object',
                        properties: { note: { type: 'string' } },
                        required: ['note']
                    }
                }
            }]
            */
        });

        // Preparamos el objeto de respuesta
        const answer = {
            text: response.message.content,
            toolCall: null
        };

        // Si Qwen emitió una llamada a una herramienta
        if (response.message.tool_calls && response.message.tool_calls.length > 0) {
            const call = response.message.tool_calls[0];
            answer.toolCall = {
                action: call.function.name,
                payload: call.function.arguments
            };
            console.log(`[Atlas AI] 🔧 Tool Call detectado: ${call.function.name}`);
        }

        console.log('[Atlas AI] ✅ Inferencia completada.');
        return answer;

    } catch (error) {
        console.error('[Atlas AI] ❌ Error conectando con el motor LLM:', error);
        return {
            text: 'Lo siento, he tenido un error al procesar tu solicitud.',
            toolCall: null
        };
    }
};
