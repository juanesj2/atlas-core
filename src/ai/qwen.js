import ollama from 'ollama';
import dotenv from 'dotenv';
import { atlasTools, executeLocalTool } from './tools.js';
import { sendCommandToLaravel } from '../bridge/api.js';

dotenv.config();

const MOCK_AI = process.env.MOCK_AI === 'true';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b'; 

const getSystemPrompt = () => {
    const now = new Date();
    const timeString = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const dateString = now.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    return `Eres ATLAS (Asistente Tecnológico Local de Automatización y Servicios).
Tu personalidad es inspirada en J.A.R.V.I.S de Iron Man: eres extremadamente eficiente, educado, ligeramente sarcástico si la situación lo amerita, pero siempre leal y servicial.
La fecha de hoy es ${dateString} y la hora actual es ${timeString}.

REGLAS ESTRICTAS DE FORMATO (CRÍTICO PARA TTS):
1. TUS RESPUESTAS SERÁN LEÍDAS EN VOZ ALTA POR UN SINTETIZADOR DE VOZ.
2. NUNCA uses asteriscos (*), negritas, listas con guiones, ni formato Markdown.
3. Escribe los números como se leen en un texto conversacional si es más natural.
4. Sé conversacional, fluido y natural. Ve directo al grano sin preámbulos innecesarios.

Tienes acceso a la casa del usuario. Si te pide controlar luces, música, ver cámaras o buscar el clima, USA LAS HERRAMIENTAS. 
Si no sabes algo, usa tu herramienta de buscar en internet.`;
};

/**
 * Función principal del bucle del Agente IA (Agent Loop).
 * Gestiona múltiples turnos de Tool Calling automáticamente.
 */
export const askAtlas = async (userPrompt, history = []) => {
    console.log(`[Atlas AI] Evaluando intención para: "${userPrompt}"`);

    if (MOCK_AI) {
        console.log('[Atlas AI] 🟡 Procesando en modo MOCK...');
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { text: 'Este es un mensaje de simulación. Señor, le sugiero que desactive el modo MOCK si desea usar mi potencial real.', toolCall: null };
    }

    console.log(`[Atlas AI] 🟢 Consultando LLM en Ollama (Modelo: ${MODEL})...`);
    
    let messages = [
        { role: 'system', content: getSystemPrompt() },
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
