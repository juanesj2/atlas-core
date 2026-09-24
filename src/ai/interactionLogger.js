import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INTERACTIONS_FILE = path.join(__dirname, '../../Cronos_interactions.jsonl');
const STATE_FILE = path.join(__dirname, '../../Cronos_learner_state.json');

/**
 * Registra una interacción en el fichero JSON Lines de forma asíncrona.
 */
export const logInteraction = async ({ username, prompt, response, toolsUsed = [], isVoice = false }) => {
    try {
        if (!prompt || !response) return;

        const entry = {
            id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
            timestamp: new Date().toISOString(),
            username: username || 'invitado',
            prompt: prompt.trim(),
            response: response.trim(),
            toolsUsed,
            isVoice
        };

        const line = JSON.stringify(entry) + '\n';
        await fs.promises.appendFile(INTERACTIONS_FILE, line, 'utf-8');
    } catch (err) {
        console.error('[InteractionLogger] Error guardando interacción:', err.message);
    }
};

/**
 * Lee las interacciones que aún no han sido procesadas por el motor de autoaprendizaje.
 */
export const getUnprocessedInteractions = async (limit = 30) => {
    if (!fs.existsSync(INTERACTIONS_FILE)) return [];

    let lastProcessedTimestamp = 0;
    if (fs.existsSync(STATE_FILE)) {
        try {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            lastProcessedTimestamp = state.lastProcessedTimestamp || 0;
        } catch (e) {
            lastProcessedTimestamp = 0;
        }
    }

    try {
        const content = await fs.promises.readFile(INTERACTIONS_FILE, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        
        const unprocessed = [];
        for (const line of lines) {
            try {
                const item = JSON.parse(line);
                const itemTime = new Date(item.timestamp).getTime();
                if (itemTime > lastProcessedTimestamp) {
                    unprocessed.push(item);
                }
            } catch (e) {}
        }

        return unprocessed.slice(-limit);
    } catch (err) {
        console.error('[InteractionLogger] Error leyendo interacciones:', err.message);
        return [];
    }
};

/**
 * Actualiza el puntero de la última interacción procesada.
 */
export const markInteractionsProcessed = (timestamp) => {
    try {
        const state = {
            lastProcessedTimestamp: timestamp || Date.now(),
            lastCycleAt: new Date().toISOString()
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
        console.error('[InteractionLogger] Error guardando estado de aprendizaje:', err.message);
    }
};

/**
 * Obtiene métricas generales de las interacciones almacenadas.
 */
export const getInteractionStats = () => {
    if (!fs.existsSync(INTERACTIONS_FILE)) {
        return { totalInteractions: 0, lastInteraction: null };
    }
    try {
        const content = fs.readFileSync(INTERACTIONS_FILE, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        const lastLine = lines[lines.length - 1];
        let lastInteraction = null;
        if (lastLine) {
            try { lastInteraction = JSON.parse(lastLine); } catch (e) {}
        }
        return {
            totalInteractions: lines.length,
            lastInteraction: lastInteraction ? lastInteraction.timestamp : null
        };
    } catch (e) {
        return { totalInteractions: 0, lastInteraction: null };
    }
};

/**
 * Obtiene el estado actual del puntero del aprendiz.
 */
export const getLearnerState = () => {
    if (!fs.existsSync(STATE_FILE)) {
        return { lastProcessedTimestamp: 0, lastCycleAt: null };
    }
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch (e) {
        return { lastProcessedTimestamp: 0, lastCycleAt: null };
    }
};
