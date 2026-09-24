import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getEmbedding, cosineSimilarity } from './embeddings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_FILE = path.join(__dirname, '../../Cronos_memory_vectors.json');

/**
 * {
 *    vectors: [
 *       { id: "123", user: "juanes", text: "Mi perro se llama Toby", vector: [0.12, -0.4, ...] }
 *    ]
 * }
 */
const readMemoryFile = () => {
    if (!fs.existsSync(MEMORY_FILE)) {
        const defaultMemory = { vectors: [] };
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(defaultMemory, null, 2), 'utf-8');
        return defaultMemory;
    }
    try {
        const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.error("[MemoryManager] Error leyendo memoria vectorial:", e);
        return { vectors: [] };
    }
};

const writeMemoryFile = (memoryObj) => {
    try {
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryObj, null, 2), 'utf-8');
    } catch (e) {
        console.error("[MemoryManager] Error escribiendo memoria vectorial:", e);
    }
};

/**
 * Guarda un hecho convirtiéndolo a vector matemáticol.
 */
export const saveFact = async (username, fact) => {
    if (!username || username.trim() === '' || username.toLowerCase() === 'invitado') {
        console.log(`[MemoryManager] Intento de guardar para usuario inválido: ${username}`);
        return false;
    }

    console.log(`[MemoryManager] Generando embedding para: "${fact}"...`);
    const vector = await getEmbedding(fact);
    
    if (!vector) {
        console.error("[MemoryManager] No se pudo guardar la memoria por error en embedding.");
        return false;
    }

    const cleanUser = username.toLowerCase().trim();
    const mem = readMemoryFile();

    // Comprobar si ya existe texto idéntico
    if (mem.vectors.some(v => v.user === cleanUser && v.text === fact)) {
        return false; // Ya lo sabe
    }

    mem.vectors.push({
        id: Date.now().toString(),
        user: cleanUser,
        text: fact,
        vector: vector
    });

    writeMemoryFile(mem);
    console.log(`[MemoryManager] 🧠 Dato RAG guardado para ${cleanUser}: "${fact}"`);
    return true;
};

/**
 * Busca por Similitud Semántica (RAG).
 */
export const getMemoryForPrompt = async (username, prompt) => {
    const cleanUser = username ? username.toLowerCase().trim() : 'invitado';
    
    // Si es invitado, no buscamos en memoria personal
    if (cleanUser === 'invitado') return "";

    const mem = readMemoryFile();
    const userVectors = mem.vectors.filter(v => v.user === cleanUser || v.user === 'global');

    if (userVectors.length === 0) return "";

    // 1. Convertir la pregunta del usuario en vector
    const promptVector = await getEmbedding(prompt);
    if (!promptVector) return "";

    // 2. Calcular distancias
    const results = userVectors.map(v => {
        return {
            text: v.text,
            score: cosineSimilarity(promptVector, v.vector)
        };
    });

    // 3. Ordenar de mayor a menor coincidencia
    results.sort((a, b) => b.score - a.score);

    // 4. Quedarnos solo con el Top 3 que superen un umbral mínimo (ej: 0.5)
    const topResults = results.filter(r => r.score > 0.4).slice(0, 3);

    if (topResults.length === 0) {
        return "";
    }

    let text = `MEMORIA A LARGO PLAZO RECUPERADA PARA '${cleanUser}' (Contexto RAG):\n`;
    topResults.forEach((r, idx) => {
        text += `${idx + 1}. ${r.text}\n`;
    });

    return text;
};

/**
 * Devuelve todos los recuerdos vectoriales (sin los vectores para ser liviano)
 */
export const getAllMemories = () => {
    const mem = readMemoryFile();
    return (mem.vectors || []).map(v => ({
        id: v.id,
        user: v.user,
        text: v.text
    }));
};

/**
 * Elimina un recuerdo vectorial por id
 */
export const deleteMemory = (id) => {
    const mem = readMemoryFile();
    const initialLen = mem.vectors.length;
    mem.vectors = mem.vectors.filter(v => v.id !== id);
    if (mem.vectors.length !== initialLen) {
        writeMemoryFile(mem);
        return true;
    }
    return false;
};
