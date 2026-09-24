import ollama from 'ollama';
import dotenv from 'dotenv';
import { getUnprocessedInteractions, markInteractionsProcessed } from './interactionLogger.js';
import { saveFact } from './memoryManager.js';
import { saveLesson } from './selfCorrection.js';
import { enqueueCuriosities } from './curiosityEngine.js';

dotenv.config();

const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b';
let isCycleRunning = false;

/**
 * Ejecuta el ciclo de autoaprendizaje y consolidación de conocimientos.
 */
export const runLearningCycle = async () => {
    if (isCycleRunning) {
        console.log('[AutoLearner] ⏳ Ciclo de aprendizaje ya en curso, omitiendo ejecución simultánea.');
        return { running: true };
    }

    isCycleRunning = true;
    console.log('[AutoLearner] 🧠 Iniciando ciclo de autoaprendizaje y consolidación...');

    try {
        const interactions = await getUnprocessedInteractions(25);
        if (!interactions || interactions.length === 0) {
            console.log('[AutoLearner] ✅ No hay nuevas interacciones pendientes de analizar.');
            isCycleRunning = false;
            return { processed: 0, factsLearned: 0, lessonsLearned: 0 };
        }

        console.log(`[AutoLearner] 🔍 Analizando ${interactions.length} interacciones recientes...`);

        // Formatear diálogo para el modelo extractor
        const transcript = interactions.map(i => {
            const time = new Date(i.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            return `[${time}] Usuario (${i.username}): "${i.prompt}"\n[${time}] Cronos: "${i.response}"`;
        }).join('\n\n');

        const systemPrompt = `Eres el subsistema de COGNICIÓN Y AUTOAPRENDIZAJE de Cronos.
Tu misión es leer la transcripción de las interacciones recientes entre los habitantes de la casa y Cronos, y extraer CONOCIMIENTO NUEVO, DURADERO Y ÚTIL.

Debes responder EXCLUSIVAMENTE con un objeto JSON válido con esta estructura:
{
  "facts": [
    { "user": "nombre_del_usuario", "fact": "Hecho o preferencia clara en tercera persona (ej: 'A Juanes le gusta programar de noche con música lofi')" }
  ],
  "corrections": [
    { "trigger": "orden o acción corregida", "rule": "Regla que Cronos debe seguir en el futuro para no repetir el error" }
  ],
  "curiosities": [
    { "topic": "concepto o tema mencionado", "query": "búsqueda para google", "reason": "por qué investigar esto para enriquecer el hogar" }
  ]
}

REGLAS DE EXTRACCIÓN:
1. "facts": Extrae gustos, preferencias, nombres de familiares/amigos (novia, amigos, mascotas), rutinas, proyectos o información relevante que hayan mencionado. NO extraigas saludos triviales ("hola", "adiós").
2. "corrections": Si el usuario corrigió a Cronos (ej: "no era esa luz", "te has equivocado", "prefiero que hagas X"), extrae la regla clara. Si no hubo correcciones, deja el array vacío.
3. "curiosities": Si el usuario preguntó por un tema interesante o quedó algo pendiente por profundizar, sugiere una búsqueda concreta.
4. Si una categoría no tiene contenido, usa un array vacío [].
5. RESPONDE SOLO EL JSON, sin explicaciones ni markdown adicional.`;

        const userMessage = `TRANSCRIPCIÓN DE DIÁLOGOS RECIENTES:\n\n${transcript}\n\nAnaliza y extrae el JSON de conocimiento:`;

        const response = await ollama.chat({
            model: MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            options: {
                temperature: 0.2, // Baja temperatura para precisión analítica
            }
        });

        const rawText = response.message?.content || '';
        let cleanJson = rawText.trim();
        
        // Limpiar bloques de código markdown ```json ... ``` si los incluye
        if (cleanJson.includes('```')) {
            cleanJson = cleanJson.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        }

        // Extraer objeto JSON si hay texto alrededor
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleanJson = jsonMatch[0];
        }

        let parsedData = { facts: [], corrections: [], curiosities: [] };
        try {
            parsedData = JSON.parse(cleanJson);
        } catch (jsonErr) {
            console.warn('[AutoLearner] ⚠️ No se pudo parsear el JSON de Ollama:', cleanJson.substring(0, 150));
        }

        let factsLearned = 0;
        let lessonsLearned = 0;
        let curiositiesEnqueued = 0;

        // 1. Guardar hechos y recuerdos en la memoria RAG vectorial
        if (Array.isArray(parsedData.facts)) {
            for (const item of parsedData.facts) {
                if (item.fact && item.fact.trim().length > 5) {
                    const targetUser = item.user || 'Juanes';
                    const saved = await saveFact(targetUser, item.fact.trim());
                    if (saved) {
                        factsLearned++;
                        console.log(`[AutoLearner] 💡 Hecho asimilado autónomamente: [${targetUser}] ${item.fact}`);
                    }
                }
            }
        }

        // 2. Guardar lecciones y correcciones
        if (Array.isArray(parsedData.corrections)) {
            for (const item of parsedData.corrections) {
                if (item.rule && item.rule.trim().length > 5) {
                    const saved = saveLesson(item.trigger, item.rule.trim());
                    if (saved) {
                        lessonsLearned++;
                    }
                }
            }
        }

        // 3. Encolar curiosidades para investigación en internet
        if (Array.isArray(parsedData.curiosities) && parsedData.curiosities.length > 0) {
            curiositiesEnqueued = enqueueCuriosities(parsedData.curiosities);
        }

        // Marcar interacciones como procesadas
        const lastItem = interactions[interactions.length - 1];
        if (lastItem) {
            markInteractionsProcessed(new Date(lastItem.timestamp).getTime());
        }

        console.log(`[AutoLearner] ✨ Ciclo completado: ${factsLearned} hechos asimilados, ${lessonsLearned} lecciones aprendidas, ${curiositiesEnqueued} curiosidades encoladas.`);
        
        return {
            processed: interactions.length,
            factsLearned,
            lessonsLearned,
            curiositiesEnqueued
        };

    } catch (err) {
        console.error('[AutoLearner] ❌ Error en ciclo de autoaprendizaje:', err.message);
        return { error: err.message };
    } finally {
        isCycleRunning = false;
    }
};
