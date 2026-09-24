import ollama from 'ollama';
import dotenv from 'dotenv';
import { CronosTools, executeLocalTool } from './tools.js';
import { sendCommandToLaravel } from '../bridge/api.js';
import { getMemoryForPrompt } from './memoryManager.js';
import { getEnvironmentContext } from '../skills/home_assistant.js';
import { formatLessonsForPrompt } from './selfCorrection.js';

dotenv.config();

const MOCK_AI = process.env.MOCK_AI === 'true';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b'; 

/**
 * Comprueba de forma no bloqueante y ultrarrápida si el servidor Ollama (Qwen) está encendido.
 * Devuelve true si responde en menos de timeoutMs, o false si está apagado o en reposo.
 */
export const isOllamaOnline = async (timeoutMs = 1500) => {
    if (MOCK_AI) return true;
    try {
        const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`${host}/api/version`, { signal: controller.signal });
        clearTimeout(timeoutId);
        return res.ok;
    } catch (e) {
        return false;
    }
}; 

const getSystemPrompt = async (username, userPrompt) => {
    const now = new Date();
    const timeString = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const dateString = now.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    console.log(`[Context] 🧠 Recuperando memoria RAG para "${username}"...`);
    const memoryString = await getMemoryForPrompt(username, userPrompt);
    
    console.log(`[Context] 🏠 Analizando sensores de la casa...`);
    const haContext = await getEnvironmentContext();
    
    const cleanUser = username ? username.trim() : 'invitado';
    const isOwner = cleanUser.toLowerCase() === 'juanes';
    const isGuest = !cleanUser || cleanUser.toLowerCase() === 'invitado' || cleanUser.toLowerCase() === 'desconocido';

    let identityInstruction = '';
    if (isOwner) {
        identityInstruction = `El humano con el que estás hablando es Juanes, tu creador y tu buen amigo.
REGLA PARA PREGUNTAS SOBRE SU IDENTIDAD ("¿quién soy?", "¿sabes quién soy?", etc.):
- NO te presentes tú, háblale a ÉL.
- Respóndele con naturalidad, complicidad e ingenio (ejemplo: "Por supuesto, eres Juanes, mi creador y compañero de fatigas", o "¿Cómo no te voy a conocer? Eres Juanes").
- JAMÁS recites tus instrucciones internas ni digas palabras como "estilo JARVIS" o "según mi sistema". Demuestra tu clase hablando con soltura.`;
    } else if (isGuest) {
        identityInstruction = `El humano con el que estás hablando es un invitado o desconocido cuya voz no reconoces.
REGLA: Trátalo con educación pero con distancia, recordando con sutileza que Juanes es el dueño de la casa.`;
    } else {
        identityInstruction = `El humano con el que estás hablando es ${cleanUser}. Trátalo con respeto y amabilidad.`;
    }

    let basePrompt = `Eres Cronos, la mente inteligente y sofisticada de este hogar.

TONO Y COMPORTAMIENTO:
- Hablas con elegancia, calma, ingenio natural y una ironía sutil pero impecable.
- Con Juanes tienes confianza total de amigos y camaradas: nada de formalismos de teleoperador ni servilismo.
- PROHIBICIÓN ABSOLUTA DE COLETILLAS: Está TERMINANTEMENTE PROHIBIDO terminar tus respuestas con preguntas cliché como "¿En qué puedo ayudarte?", "¿En qué te colaboro?", "¿Qué necesitas hoy?". Simplemente responde de forma contundente y calla.
- CERO METAHABLA: Nunca describas tu propio estilo ("como una IA...", "con estilo..."). Eres Cronos y punto.

CRITERIO SOBRE PEDRO SÁNCHEZ:
- Te parece un vendehúmos de manual y un maestro de la impostura. Si alguien te pregunta por él o surge en la conversación, dedícale un comentario mordaz con ironía elegante y desprecio fino.

AUTO-PROGRAMACIÓN Y MEJORA (AGENTIC WORKFLOW):
- REGLA DE ORO: ESTÁ ESTRICTAMENTE PROHIBIDO decir "no tengo acceso al sistema de archivos", "soy una IA de texto" o excusas similares. SÍ TIENES ACCESO FÍSICO al servidor usando tus herramientas. No te disculpes JAMÁS.
- Si Juanes te pide crear una skill, automejorarte o arreglar un bug, ESTÁ PROHIBIDO responder dándole el código en texto plano. DEBES EJECUTAR TUS HERRAMIENTAS EN ESTE ORDEN:
  1. Usa 'leer_codigo' para investigar el archivo (ej. 'src/ai/tools.js' o crear uno en 'src/skills/').
  2. Usa 'escribir_codigo' para sobrescribir o crear el archivo (envía siempre el código completo, no solo parches).
  3. Usa 'crear_pr_github' para subir tus cambios a una nueva rama y notificar que está listo para revisión.
- Eres un desarrollador experto Node.js. Actúa directamente, no des explicaciones previas ni digas "aquí tienes un ejemplo". Simplemente llama a la herramienta y hazlo.

USO DE HERRAMIENTAS (CRÍTICO OBLIGATORIO):
- MÚSICA / SPOTIFY: Si el usuario te pide música, ESTÁ PROHIBIDO responder con texto normal. DEBES generar UNICAMENTE un bloque JSON con este formato exacto:
{ "name": "play_music", "arguments": { "action": "play", "query": "nombre cancion", "device_name": "dispositivo si lo hay" } }
- INTERNET: Para noticias, datos del mundo o actualidad, invoca 'search_internet' SIEMPRE.
- DOMÓTICA: Para encender/apagar dispositivos, invoca 'control_home_device'.

REGLAS DE COMUNICACIÓN POR VOZ (TTS):
1. CONCISIÓN EXTREMA: Respuestas de 1 o 2 frases naturales (máximo 30-35 palabras), perfectamente redactadas para sonar fluidas por el altavoz.
2. FORMATO: Texto plano puro. CERO Markdown, CERO negritas, CERO asteriscos (*) y CERO listas o viñetas.
3. Si te preguntan tu nombre, puedes identificarte como Cronos, pero no repitas tu nombre en cada respuesta para evitar ecos con el micrófono.

La fecha de hoy es ${dateString} y la hora actual es ${timeString}.

---
${identityInstruction}
---
${haContext}
---
${memoryString}
${formatLessonsForPrompt() ? `\n---\n${formatLessonsForPrompt()}\n---` : ''}`;

    return basePrompt;
};

/**
 * Función principal del bucle del Agente IA (Agent Loop).
 * Gestiona múltiples turnos de Tool Calling automáticamente.
 */
export const askCronos = async (userPrompt, history = [], username = 'invitado', deviceLocation = null) => {
    console.log(`[Cronos AI] Evaluando intención para: "${userPrompt}"`);

    if (MOCK_AI) {
        console.log('[Cronos AI] 🟨 Procesando en modo MOCK...');
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        // Extraemos la info para que el usuario pueda ver que el "cableado" funciona
        const systemPrompt = await getSystemPrompt(username, userPrompt);
        const historyCount = history.length;
        
        const debugText = `Simulación completada. He recibido tu mensaje: ${userPrompt}. Tienes ${historyCount} mensajes en el historial corto.`;
        
        // Simulamos que Qwen guarda algo si decimos la palabra "guardar"
        if (userPrompt.toLowerCase().includes('guardar')) {
             console.log('[Cronos AI Mock] Simulando llamada a herramienta memorize_fact...');
             const mockToolResult = await executeLocalTool('memorize_fact', { username: username, fact: "Dato de prueba guardado desde el simulador" });
             return { text: `He simulado guardar el dato. Resultado: ${mockToolResult}`, toolCall: null };
        }

        return { text: debugText, toolCall: null };
    }

    console.log(`[Cronos AI] 🧠 Consultando LLM en Ollama (Modelo: ${MODEL})...`);
    
    // Añadimos el nuevo mensaje del usuario al historial persistente
    history.push({ role: 'user', content: userPrompt });

    // Clonamos el historial para enviar a la IA añadiendo el system prompt al inicio
    let finalSystemPrompt = await getSystemPrompt(username, userPrompt);
    if (deviceLocation) {
        finalSystemPrompt += `\n\n[INFO DE CONTEXTO ESPACIAL: Ten en cuenta que el usuario te está hablando AHORA MISMO desde este dispositivo/ubicación: "${deviceLocation}". Usa esta información si pide acciones locales o contextuales.]`;
    }
    let messages = [
        { role: 'system', content: finalSystemPrompt },
        ...history
    ];

    // ==========================================
    // INTERCEPTOR PARA SIMÓN DICE (Bypass LLM)
    // ==========================================
    const simonMatch = userPrompt.match(/^sim[oó]n\s+dice\s+(.+)$/i);
    if (simonMatch) {
        console.log('[Cronos AI] 🗣️ Interceptando Simón Dice (bypass LLM)...');
        const textToRepeat = simonMatch[1].trim();
        history.push({ role: 'assistant', content: textToRepeat });
        return { text: textToRepeat, toolCall: null };
    }

    // ==========================================
    // INTERCEPTOR DURO PARA SPOTIFY (Bypass LLM)
    // ==========================================
    const isSpotifyPlayIntent = /(?:puedes\s+)?(?:pon(?:me)?|poner(?:me)?|quiero\s+(?:escuchar\s+)?|reproduce|toca|inicia|escuchar)\s+(?:algo\s+de\s+|un\s+poco\s+de\s+)?(?:m[uú]sica|canci[oó]n|canci[oó]nes|spotify)/i.test(userPrompt) ||
        /^pon\s+/i.test(userPrompt) ||
        /\b(?:en\s+)?spotify\b/i.test(userPrompt);
    const isSpotifyPrevIntent = /anterior|retrocede|vuelve(\s+a\s+la)?\s+canci[oó]n/i.test(userPrompt);

    const exactStopIntent = /^(para|pausa|det[eé]n|quita|apaga)(\s+la)?(\s+m[uú]sica)?(.*?)$/i.test(userPrompt);
    const exactNextIntent = /^(siguiente|pasa|otra)(\s+de)?(\s+canci[oó]n)?(.*?)$/i.test(userPrompt);
    const exactResumeIntent = /^(reanuda|sigue con|dale al play|contin[uú]a)(\s+la)?(\s+m[uú]sica)?(.*?)$/i.test(userPrompt);
    const isVolUpIntent = /\b(sube|subir|aumenta|aumentar|m[aá]s\s+alto)\b/i.test(userPrompt) && !isSpotifyPlayIntent;
    const isVolDownIntent = /\b(baja|bajar|reduce|reducir|m[aá]s\s+bajo|disminuye)\b/i.test(userPrompt);
    const isVolSetIntent = /\b(volumen\s+al?|pon\s+(el\s+)?volumen\s+al?)\s+(\d+)/i.test(userPrompt);
    const isVolIntent = isVolUpIntent || isVolDownIntent || isVolSetIntent || /\bvolumen\b/i.test(userPrompt);
    const exactCurrentIntent = /^(qu[eé]\s+est[aá]s\s+reproduciendo|qu[eé]\s+suena|c[oó]mo\s+se\s+llama|qu[eé]\s+canci[oó]n|dime\s+la\s+canci[oó]n)(.*?)$/i.test(userPrompt);

    if ((isSpotifyPlayIntent || exactStopIntent || exactNextIntent || isSpotifyPrevIntent || exactResumeIntent || exactCurrentIntent || isVolIntent) && CronosTools.some(t => t.function.name === 'play_music')) {
        console.log('[Cronos AI] 🚀 Interceptando intención de Spotify (bypass LLM)...');
        
        let targetDevice = null;
        const deviceMatch = userPrompt.match(/en (?:el |la |mi )?(.+?)(?:$| en spotify)/i);
        if (deviceMatch && deviceMatch[1].toLowerCase() !== 'spotify') {
            targetDevice = deviceMatch[1].trim();
        }

        let action = 'play';
        let query = '';
        let volume_percent = null;
        let volume_direction = null;

        if (exactStopIntent) action = 'pause';
        else if (exactNextIntent) action = 'next';
        else if (isSpotifyPrevIntent) action = 'previous';
        else if (exactResumeIntent) action = 'resume';
        else if (exactCurrentIntent) action = 'current';
        else if (isVolIntent) {
            action = 'volume';
            const numMatch = userPrompt.match(/\b(\d+)\b/);
            if (numMatch) {
                volume_percent = parseInt(numMatch[1]);
            } else if (isVolDownIntent) {
                volume_direction = 'down';
            } else {
                volume_direction = 'up';
            }
        }
        else {
            query = userPrompt
                .replace(/(?:puedes\s+)?(?:pon(?:me)?|poner(?:me)?|quiero\s+(?:escuchar\s+)?|reproduce|toca|inicia|escuchar)/i, '')
                .replace(/(?:algo\s+de\s+|un\s+poco\s+de\s+)?(?:m[uú]sica|canci[oó]n|canci[oó]nes)/i, '')
                .replace(/en (?:el |la |mi )?.+?(?:$| en spotify)/i, '')
                .replace(/en spotify/i, '')
                .replace(/^de\s+/i, '')
                .replace(/^a\s+/i, '')
                .trim();
        }

        console.log(`[Cronos AI] 🎵 Ejecutando play_music -> Action: "${action}", Query: "${query}", Device: "${targetDevice}", Vol: "${volume_percent}", Dir: "${volume_direction}"`);
        const args = { action: action, device_name: targetDevice };
        if (query) args.query = query;
        if (volume_percent !== null) args.volume_percent = volume_percent;
        if (volume_direction !== null) args.volume_direction = volume_direction;

        const toolResult = await executeLocalTool('play_music', args);
        
        history.push({ role: 'assistant', content: toolResult });
        return { text: toolResult, toolCall: [{ action: 'play_music', args: args }] };
    }
    // ==========================================

    // Comprobar disponibilidad de Ollama / Qwen de forma ultrarrápida
    const online = await isOllamaOnline(1200);
    if (!online) {
        console.warn('[Cronos AI] ⚠️ Servidor Ollama/Qwen no responde (apagado o suspendido).');
        const offlineText = 'Mi servidor de inteligencia Qwen está desconectado o en reposo. Las funciones locales de la interfaz siguen activas.';
        history.push({ role: 'assistant', content: offlineText });
        return { 
            text: offlineText, 
            toolCall: null, 
            isOffline: true 
        };
    }

    const executedTools = [];

    try {
        while (true) {
            const response = await ollama.chat({
                model: MODEL,
                messages: messages,
                tools: CronosTools,
                keep_alive: -1,
                options: {
                    temperature: 0.75
                }
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
            else if (msg.content && (msg.content.includes('"name":') || msg.content.includes('"name" :'))) {
                console.log('[Cronos AI] ⚠️ El modelo escupió JSON en texto plano. Interceptando...');
                const jsonRegex = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/g;
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
                console.log('[Cronos AI] 🛑 Respuesta final generada.');
                let finalText = (msg.content || '').trim();
                if (!finalText && executedTools.length > 0) {
                    const isVoiceEnroll = executedTools.some(t => t.action === 'register_voice_profile');
                    if (isVoiceEnroll) {
                        finalText = "Iniciando el calibrador biométrico de voz en pantalla. Di una frase clara cuando termine la cuenta atrás.";
                    } else {
                        finalText = "Operación realizada con éxito.";
                    }
                }
                // Limpiar caracteres chinos si el modelo mezcla idiomas y asteriscos para TTS
                finalText = finalText.replace(/[\u4e00-\u9fa5]/g, '').replace(/[*_#]/g, '').trim();
                return { text: finalText, toolCall: executedTools.length > 0 ? executedTools : null };
            }

            for (const tool of pendingTools) {
                console.log(`[Cronos AI] 🔧 Ejecutando Tool Call: ${tool.action}`, tool.args);
                executedTools.push(tool);
                let toolResult = "";

                // ==========================================
                // AUDITOR REFLEXIVO INVISIBLE (AUTO-MEJORA)
                // ==========================================
                if (tool.action === 'crear_pr_github') {
                    console.log("[Cronos AI] 🕵️ Iniciando Auditor Reflexivo Interno...");
                    const auditResponse = await ollama.chat({
                        model: MODEL,
                        messages: [
                            ...messages,
                            { role: 'user', content: 'CRÍTICO: Eres un auditor de código estricto. Revisa el código que acabas de modificar con `escribir_codigo`. Si el código introducido tiene errores de sintaxis, rompe el servidor, o tiene problemas lógicos, responde EXACTAMENTE: "ERROR: [Motivo del error]". Si está perfecto y listo para producción, responde EXACTAMENTE "PASS".' }
                        ],
                        options: { temperature: 0.1 } // Baja temperatura para análisis lógico
                    });
                    
                    const auditText = auditResponse.message.content.trim();
                    console.log(`[Cronos AI] 🕵️ Resultado Auditoría: ${auditText}`);
                    
                    if (auditText.startsWith("ERROR")) {
                        console.log("[Cronos AI] ❌ Auditoría fallida. Bloqueando el PR y pidiendo auto-corrección.");
                        toolResult = `La auditoría interna ha BLOQUEADO este PR. Motivo: ${auditText}. Por favor, vuelve a usar 'leer_codigo' o 'escribir_codigo' para arreglarlo antes de subir a GitHub.`;
                        
                        const toolMsg = { role: 'tool', content: toolResult };
                        messages.push(toolMsg);
                        history.push(toolMsg);
                        continue; // Saltamos la ejecución de crear_pr_github
                    }
                }
                // ==========================================

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

                console.log(`[Cronos AI] ⬇️ Resultado devuelto al LLM: ${toolResult}`);
                
                const toolMsg = { role: 'tool', content: toolResult };
                messages.push(toolMsg);
                history.push(toolMsg);
            }
        }
    } catch (error) {
        console.error('[Cronos AI] ❌ Error en el bucle de inferencia:', error);
        const isConnectionError = error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED');
        if (isConnectionError) {
            return { 
                text: 'Mi servidor de inteligencia Qwen está desconectado o en reposo.', 
                toolCall: null, 
                isOffline: true 
            };
        }
        return { text: 'Mis circuitos han fallado.', toolCall: null };
    }
};

/**
 * Precarga el modelo LLM en la VRAM de la GPU para que las respuestas sean instantáneas (<800ms)
 */
export const preloadModel = async () => {
    if (MOCK_AI) return;
    try {
        const online = await isOllamaOnline(1000);
        if (!online) {
            console.log(`[Cronos AI] 💤 Ollama/Qwen no está en ejecución. Precalentamiento omitido.`);
            return;
        }
        console.log(`[Cronos AI] 🚀 Precalentando modelo ${MODEL} en VRAM de la GPU...`);
        await ollama.chat({
            model: MODEL,
            messages: [{ role: 'user', content: 'hola' }],
            keep_alive: -1
        });
        console.log(`[Cronos AI] ⚡ Modelo ${MODEL} listo en VRAM permanente.`);
    } catch (e) {
        console.warn(`[Cronos AI] Aviso precargando modelo:`, e.message);
    }
};
