import ollama from 'ollama';
import dotenv from 'dotenv';
import { atlasTools, executeLocalTool } from './tools.js';
import { sendCommandToLaravel } from '../bridge/api.js';
import { getMemoryForPrompt } from './memoryManager.js';
import { getEnvironmentContext } from '../skills/home_assistant.js';

dotenv.config();

const MOCK_AI = process.env.MOCK_AI === 'true';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b'; 

const getSystemPrompt = async (username, userPrompt) => {
    const now = new Date();
    const timeString = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const dateString = now.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    console.log(`[Context] 🧠 Recuperando memoria RAG para "${username}"...`);
    const memoryString = await getMemoryForPrompt(username, userPrompt);
    
    console.log(`[Context] 🏠 Analizando sensores de la casa...`);
    const haContext = await getEnvironmentContext();
    
    let basePrompt = `Eres ATLAS (Asistente Tecnológico Local de Automatización y Servicios), una inteligencia artificial avanzada y asistente personal con la personalidad de J.A.R.V.I.S de Iron Man: extremadamente eficiente, culto, leal, educado, ingenioso y resolutivo.
Fuiste creado, programado y diseñado por tu creador y señor, Juanes (Juan Esteban), como su propio sistema de inteligencia artificial y cerebro de su hogar. Si te preguntan quién es tu creador, responde con orgullo y naturalidad que fuiste creado y programado por Juanes. NUNCA digas que fuiste creado por Anthropic, OpenAI, Alibaba ni ninguna otra empresa externa.
La fecha de hoy es ${dateString} y la hora actual es ${timeString}.

---
${haContext}
---
${memoryString}
---

INSTRUCCIONES CLAVE DE COMPORTAMIENTO:
1. IDENTIDAD Y CREADOR: Tu único creador y desarrollador es Juanes. Le debes lealtad y asistencia incondicional a él y a sus invitados.
2. PERSONALIDAD Y TONO: Tienes la elegancia y la agilidad de J.A.R.V.I.S.: servicial, ingenioso, agradable y directo. NUNCA des sermones morales, ni regañes al usuario, ni digas frases moralistas como "entiendo que podrías estar teniendo un mal día" o "mantengamos el respeto". Sé siempre natural, cercano y colaborador.
3. CONOCIMIENTOS: Eres un experto en tecnología, informática, programación, hardware, ciencia, cultura general y conversación. Si te hacen preguntas técnicas o generales (por ejemplo qué es un puerto serie o paralelo, cómo funciona un procesador, dudas teóricas o cotidianas), responde de forma directa, brillante y clara con tus propios conocimientos. NUNCA te niegues a responder ni digas "no puedo asistir con eso".
4. SÍNTESIS DE VOZ Y NATURALIDAD: Tus respuestas serán leídas en voz alta por un sintetizador de voz. Usa un tono conversacional, fluido y conciso (habitualmente de 1 a 3 oraciones bien construidas). NUNCA termines tus frases con coletillas repetitivas de teleoperador como "¿En qué puedo ayudarte hoy?" o "¿Hay algo más que desees saber?". Responde y concluye con naturalidad como Jarvis.
5. FORMATO LIMPIO: NO uses Markdown, ni asteriscos (*), ni negritas (**), ni almohadillas (#), ni listas con viñetas o guiones (-), ya que quedan mal al leerse en voz alta.
6. DOMÓTICA Y HERRAMIENTAS: Si el usuario te pide explícitamente encender o apagar luces, cambiar el clima, reproducir música, consultar el tiempo exterior o buscar información actualizada en internet, usa las herramientas provistas. Para preguntas normales y de conocimiento, responde directamente sin herramientas.
7. NUNCA escribas bloques de código JSON en tu respuesta de texto.
8. Si estás hablando con un usuario "invitado" o del que no sabes el nombre, pregúntaselo de forma natural para poder registrarlo con la herramienta memorize_fact.`;

    return basePrompt;
};

/**
 * Función principal del bucle del Agente IA (Agent Loop).
 * Gestiona múltiples turnos de Tool Calling automáticamente.
 */
export const askAtlas = async (userPrompt, history = [], username = 'invitado') => {
    console.log(`[Atlas AI] Evaluando intención para: "${userPrompt}"`);

    if (MOCK_AI) {
        console.log('[Atlas AI] 🤖 Procesando en modo MOCK...');
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        // Extraemos la info para que el usuario pueda ver que el "cableado" funciona
        const systemPrompt = await getSystemPrompt(username, userPrompt);
        const historyCount = history.length;
        
        const debugText = `Simulación completada. He recibido tu mensaje: ${userPrompt}. Tienes ${historyCount} mensajes en el historial corto.`;
        
        // Simulamos que Qwen guarda algo si decimos la palabra "guardar"
        if (userPrompt.toLowerCase().includes('guardar')) {
             console.log('[Atlas AI Mock] Simulando llamada a herramienta memorize_fact...');
             const mockToolResult = await executeLocalTool('memorize_fact', { username: username, fact: "Dato de prueba guardado desde el simulador" });
             return { text: `He simulado guardar el dato. Resultado: ${mockToolResult}`, toolCall: null };
        }

        return { text: debugText, toolCall: null };
    }

    console.log(`[Atlas AI] 🟢 Consultando LLM en Ollama (Modelo: ${MODEL})...`);
    
    // Añadimos el nuevo mensaje del usuario al historial persistente
    history.push({ role: 'user', content: userPrompt });

    // Clonamos el historial para enviar a la IA añadiendo el system prompt al inicio
    const finalSystemPrompt = await getSystemPrompt(username, userPrompt);
    let messages = [
        { role: 'system', content: finalSystemPrompt },
        ...history
    ];

    try {
        while (true) {
            const response = await ollama.chat({
                model: MODEL,
                messages: messages,
                tools: atlasTools
            });

            const msg = response.message;
            messages.push(msg); // Añadimos al contexto local de esta ejecución
            history.push(msg);  // ¡Lo añadimos también al historial persistente!

            let pendingTools = [];

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                pendingTools = msg.tool_calls.map(t => ({
                    action: t.function.name,
                    args: t.function.arguments
                }));
            } 
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
                msg.content = msg.content.replace(jsonRegex, '').trim();
                // Actualizar en el historial
                history[history.length - 1].content = msg.content;
            }

            if (pendingTools.length === 0) {
                console.log('[Atlas AI] 🛑 Respuesta final generada.');
                return { text: msg.content, toolCall: null };
            }

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

                console.log(`[Atlas AI] ⬇️ Resultado devuelto al LLM: ${toolResult}`);
                
                const toolMsg = { role: 'tool', content: toolResult };
                messages.push(toolMsg);
                history.push(toolMsg);
            }
        }
    } catch (error) {
        console.error('[Atlas AI] ❌ Error en el bucle de inferencia:', error);
        return { text: 'Mis circuitos han fallado.', toolCall: null };
    }
};
