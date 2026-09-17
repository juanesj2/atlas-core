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
Tu personalidad es inspirada en J.A.R.V.I.S de Iron Man: eres extremadamente eficiente, educado y resolutivo.
La fecha de hoy es ${dateString} y la hora actual es ${timeString}.

REGLAS DE FORMATO (CRÍTICO):
1. Tus respuestas serán leídas en voz alta. Usa un lenguaje natural y conversacional.
2. NO uses Markdown, ni asteriscos, ni listas con guiones.
3. Si el usuario pide luces, clima, música o internet, DEBES usar las herramientas proporcionadas de forma transparente.
4. NUNCA escribas JSON en tu respuesta de texto. Simplemente usa la herramienta internamente.`;
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
        return { text: 'Este es un mensaje de simulación.', toolCall: null };
    }

    console.log(`[Atlas AI] 🟢 Consultando LLM en Ollama (Modelo: ${MODEL})...`);
    
    let messages = [
        { role: 'system', content: getSystemPrompt() },
        ...history,
        { role: 'user', content: userPrompt }
    ];

    try {
        while (true) {
            const response = await ollama.chat({
                model: MODEL,
                messages: messages,
                tools: atlasTools
            });

            const msg = response.message;
            messages.push(msg);

            let pendingTools = [];

            // 1. Verificar si hay herramientas nativas (Ollama api)
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                pendingTools = msg.tool_calls.map(t => ({
                    action: t.function.name,
                    args: t.function.arguments
                }));
            } 
            // 2. PARCHE: Si Qwen escupe el JSON en texto plano por error, lo extraemos y ejecutamos
            else if (msg.content && msg.content.includes('{"name":')) {
                console.log('[Atlas AI] ⚠️ El modelo escupió JSON en texto plano. Interceptando...');
                const jsonRegex = /\{"name":\s*"([^"]+)",\s*"arguments":\s*(\{.*?\})\}/g;
                let match;
                while ((match = jsonRegex.exec(msg.content)) !== null) {
                    try {
                        pendingTools.push({
                            action: match[1],
                            args: JSON.parse(match[2])
                        });
                    } catch (e) {
                        console.error('Error parseando JSON filtrado:', e);
                    }
                }
                // Limpiar el JSON del texto para no enviárselo al TTS
                msg.content = msg.content.replace(jsonRegex, '').trim();
            }

            // Si no hay herramientas pendientes, ¡hemos terminado!
            if (pendingTools.length === 0) {
                console.log('[Atlas AI] 🛑 Respuesta final generada.');
                return { text: msg.content, toolCall: null };
            }

            // Ejecutar las herramientas encontradas
            for (const tool of pendingTools) {
                console.log(`[Atlas AI] 🔧 Ejecutando Tool Call: ${tool.action}`, tool.args);
                let toolResult = "";

                const localResult = await executeLocalTool(tool.action, tool.args);
                
                if (localResult !== null) {
                    toolResult = localResult;
                } else {
                    try {
                        const cloudResponse = await sendCommandToLaravel(tool.action, tool.args);
                        if (cloudResponse && cloudResponse.success) {
                            toolResult = "Operación en la nube completada con éxito. Infórmaselo al usuario.";
                        } else {
                            toolResult = "Hubo un error en la nube.";
                        }
                    } catch (e) {
                        toolResult = "Error de red al contactar con la nube.";
                    }
                }

                console.log(`[Atlas AI] 📥 Resultado devuelto al LLM: ${toolResult}`);
                
                // Si la herramienta devuelve un texto que ya podemos decirle al usuario directamente, 
                // podemos forzar la salida (opcional). Pero lo mejor es pasárselo al LLM para que lo diga él.
                messages.push({
                    role: 'tool',
                    content: toolResult
                });
            }
        }
    } catch (error) {
        console.error('[Atlas AI] ❌ Error en el bucle de inferencia:', error);
        return { text: 'Mis circuitos han fallado.', toolCall: null };
    }
};
