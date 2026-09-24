import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ollama from 'ollama';
import dotenv from 'dotenv';
import { execute as executeWebSearch } from '../skills/web_search.js';
import { saveFact } from './memoryManager.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CURIOSITY_QUEUE_FILE = path.join(__dirname, '../../Cronos_curiosity_queue.json');
const EXPLORED_TOPICS_FILE = path.join(__dirname, '../../Cronos_explored_topics.json');
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b';

let isExploring = false;

export const getCuriosityQueue = () => {
    if (!fs.existsSync(CURIOSITY_QUEUE_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(CURIOSITY_QUEUE_FILE, 'utf-8'));
    } catch (e) {
        return [];
    }
};

const writeCuriosityQueue = (queue) => {
    try {
        fs.writeFileSync(CURIOSITY_QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf-8');
    } catch (e) {
        console.error('[CuriosityEngine] Error escribiendo cola de curiosidad:', e);
    }
};

export const getExploredTopics = () => {
    if (!fs.existsSync(EXPLORED_TOPICS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(EXPLORED_TOPICS_FILE, 'utf-8'));
    } catch (e) {
        return [];
    }
};

const appendExploredTopic = (item) => {
    const explored = getExploredTopics();
    explored.push(item);
    if (explored.length > 50) explored.splice(0, 10); // Mantener últimos 50
    try {
        fs.writeFileSync(EXPLORED_TOPICS_FILE, JSON.stringify(explored, null, 2), 'utf-8');
    } catch (e) {}
};

/**
 * Añade nuevos temas a la cola de curiosidad para explorar más adelante.
 */
export const enqueueCuriosities = (items = []) => {
    const queue = getCuriosityQueue();
    let added = 0;

    for (const item of items) {
        if (!item.topic || !item.query) continue;
        const exists = queue.some(q => q.topic.toLowerCase() === item.topic.toLowerCase());
        if (!exists) {
            queue.push({
                id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
                topic: item.topic.trim(),
                query: item.query.trim(),
                reason: item.reason || '',
                createdAt: new Date().toISOString()
            });
            added++;
        }
    }

    if (added > 0) {
        writeCuriosityQueue(queue);
        console.log(`[CuriosityEngine] 🌌 ${added} temas encolados para exploración autónoma.`);
    }

    return added;
};

/**
 * Ejecuta una sesión de exploración autónoma en internet (ideal para reposo o noche).
 */
export const runCuriosityExploration = async (maxItems = 2) => {
    if (isExploring) {
        console.log('[CuriosityEngine] ⏳ Exploración ya en curso.');
        return { running: true };
    }

    const queue = getCuriosityQueue();
    if (queue.length === 0) {
        console.log('[CuriosityEngine] 💤 No hay temas pendientes en la cola de curiosidad.');
        return { explored: 0 };
    }

    isExploring = true;
    console.log(`[CuriosityEngine] 🚀 Iniciando exploración de hasta ${maxItems} temas de la red...`);

    const toProcess = queue.splice(0, maxItems);
    writeCuriosityQueue(queue);

    let successfullyExplored = 0;

    for (const item of toProcess) {
        try {
            console.log(`[CuriosityEngine] 🌐 Investigando: "${item.topic}" (Query: "${item.query}")...`);
            const searchResult = await executeWebSearch({ query: item.query });

            if (!searchResult || searchResult.length < 30) {
                console.warn(`[CuriosityEngine] Sin resultados concluyentes para "${item.topic}".`);
                continue;
            }

            // Sintetizar conocimiento con Ollama
            const summaryPrompt = `Eres Cronos. Has investigado en internet de forma autónoma sobre el tema: "${item.topic}".
Resultados de la búsqueda:
"${searchResult}"

Extrae y resume en 1 o 2 frases claras el CONOCIMIENTO ESENCIAL que has aprendido para tu acervo general y cultura del hogar.
Escríbelo de forma natural y directa (ej: "Se ha descubierto que...", "En Albacete recientemente ocurrió que...", "El protocolo Matter permite...").
Sin preámbulos.`;

            const res = await ollama.chat({
                model: MODEL,
                messages: [{ role: 'user', content: summaryPrompt }],
                options: { temperature: 0.3 }
            });

            const summary = res.message?.content ? res.message.content.trim() : '';
            if (summary && summary.length > 15) {
                // Guardar en la memoria global de Cronos
                await saveFact('global', `[Conocimiento aprendido sobre ${item.topic}]: ${summary}`);
                
                appendExploredTopic({
                    topic: item.topic,
                    query: item.query,
                    summary,
                    reason: item.reason,
                    exploredAt: new Date().toISOString()
                });

                successfullyExplored++;
                console.log(`[CuriosityEngine] 💡 Conocimiento adquirido sobre "${item.topic}": ${summary}`);
            }

        } catch (itemErr) {
            console.error(`[CuriosityEngine] Error explorando "${item.topic}":`, itemErr.message);
        }
    }

    isExploring = false;
    return { explored: successfullyExplored, remainingInQueue: queue.length };
};
