import ollama from 'ollama';
import dotenv from 'dotenv';
import { atlasTools, executeLocalTool } from './tools.js';
import { sendCommandToLaravel } from '../bridge/api.js';

dotenv.config();

const MOCK_AI = process.env.MOCK_AI === 'true';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b'; // Fallback por si acaso

const SYSTEM_PROMPT = `Eres Atlas, el asistente virtual de un hogar inteligente.
Tu objetivo es ayudar al usuario de manera natural, concisa y servicial en español.
No uses formato markdown complejo ni listas largas, ya que tus respuestas serán leídas en voz alta por un sintetizador de voz (TTS).
Tienes acceso a herramientas para controlar la domótica, poner música, ver el clima y guardar notas.
Usa las herramientas siempre que el usuario te pida realizar una acción correspondiente.`;

/**
 * Función principal del bucle del Agente IA (Agent Loop).
 * Gestiona múltiples turnos de Tool Calling automáticamente.
 */
export const askAtlas = async (userPrompt, history = []) => {
    console.log(`[Atlas AI] Evaluando intención para: "${userPrompt}"`);

    if (MOCK_AI) {
        console.log('[Atlas AI] 🟡 Procesando en modo MOCK...');
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { text: 'Este es un mensaje de simulación porque MOCK_AI está activado.', toolCall: null };
    }

    console.log(`[Atlas AI] 🟢 Consultando LLM en Ollama (Modelo: ${MODEL})...`);
    
    let messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userPrompt }
    ];

    try {
        // Bucle de evaluación (Agent Loop)
        while (true) {
            const response = await ollama.chat({
                model: MODEL,
                messages: messages,
                tools: atlasTools
            });

            const msg = response.message;
            messages.push(msg); // Guardamos la respuesta del modelo en el historial del turno

            // Si el modelo decide que NO necesita herramientas, devuelve el texto final
            if (!msg.tool_calls || msg.tool_calls.length === 0) {
                console.log('[Atlas AI] ✅ Respuesta final generada.');
                return {
                    text: msg.content,
                    toolCall: null // Ya ejecutamos las herramientas internamente
                };
            }

            // Si el modelo decide USAR herramientas, las procesamos
            for (const tool of msg.tool_calls) {
                const action = tool.function.name;
                const args = tool.function.arguments;
                
                console.log(`[Atlas AI] 🔧 Ejecutando Tool Call: ${action}`, args);
                
                let toolResult = "";

                // 1. Intentamos ejecutarla localmente (Clima, Música)
                const localResult = await executeLocalTool(action, args);
                
                if (localResult !== null) {
                    toolResult = localResult;
                } else {
                    // 2. Si no es local, asumimos que es para la Nube (Laravel)
                    try {
                        const cloudResponse = await sendCommandToLaravel(action, args);
                        if (cloudResponse && cloudResponse.success) {
                            toolResult = "Operación en la nube completada con éxito. Confírmaselo al usuario.";
                        } else {
                            toolResult = "Hubo un error al ejecutar la operación en la nube.";
                        }
                    } catch (e) {
                        toolResult = "Error de red al contactar con la nube.";
                    }
                }

                console.log(`[Atlas AI] ⬅️ Resultado de la herramienta devuelto al LLM: ${toolResult}`);

                // Devolvemos el resultado al LLM añadiéndolo al historial como un rol 'tool'
                messages.push({
                    role: 'tool',
                    content: toolResult
                });
            }
            
            // El bucle 'while' continuará, enviando todo el historial (con los resultados)
            // de vuelta a Ollama para que genere la respuesta natural hablada.
        }

    } catch (error) {
        console.error('[Atlas AI] ❌ Error en el bucle de inferencia:', error);
        return {
            text: 'Lo siento, mis circuitos cognitivos han fallado al procesar esa orden.',
            toolCall: null
        };
    }
};
