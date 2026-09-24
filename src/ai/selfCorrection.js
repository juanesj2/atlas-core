import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LESSONS_FILE = path.join(__dirname, '../../Cronos_lessons.json');

/**
 * Lee todas las lecciones y correcciones aprendidas.
 */
export const getLessons = () => {
    if (!fs.existsSync(LESSONS_FILE)) return [];
    try {
        const data = fs.readFileSync(LESSONS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.error('[SelfCorrection] Error leyendo Cronos_lessons.json:', e);
        return [];
    }
};

/**
 * Guarda una nueva lección o corrección aprendida.
 */
export const saveLesson = (trigger, rule, context = '') => {
    if (!rule || !rule.trim()) return false;
    const lessons = getLessons();
    const cleanRule = rule.trim();

    // Evitar duplicados exactos
    if (lessons.some(l => l.rule.toLowerCase() === cleanRule.toLowerCase())) {
        return false;
    }

    lessons.push({
        id: Date.now().toString(36),
        trigger: (trigger || '').trim(),
        rule: cleanRule,
        context: (context || '').trim(),
        learnedAt: new Date().toISOString()
    });

    try {
        fs.writeFileSync(LESSONS_FILE, JSON.stringify(lessons, null, 2), 'utf-8');
        console.log(`[SelfCorrection] 📝 Nueva lección aprendida: "${cleanRule}"`);
        return true;
    } catch (e) {
        console.error('[SelfCorrection] Error guardando lección:', e);
        return false;
    }
};

/**
 * Formatea las lecciones activas para inyectarlas directamente en el system prompt de Qwen.
 */
export const formatLessonsForPrompt = () => {
    const lessons = getLessons();
    if (lessons.length === 0) return '';

    // Tomar las últimas 8 lecciones más relevantes
    const recent = lessons.slice(-8);
    const lines = recent.map(l => `- Si el contexto es "${l.trigger}": ${l.rule}`);
    return `LECCIONES Y EXPERIENCIAS APRENDIDAS DE INTERACCIONES PASADAS:\n${lines.join('\n')}`;
};

/**
 * Elimina una lección por id.
 */
export const deleteLesson = (id) => {
    const lessons = getLessons();
    const initialLen = lessons.length;
    const filtered = lessons.filter(l => l.id !== id);
    if (filtered.length !== initialLen) {
        try {
            fs.writeFileSync(LESSONS_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
            return true;
        } catch (e) {
            console.error('[SelfCorrection] Error eliminando lección:', e);
        }
    }
    return false;
};

/**
 * Borra todas las lecciones.
 */
export const clearAllLessons = () => {
    try {
        fs.writeFileSync(LESSONS_FILE, JSON.stringify([], null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error('[SelfCorrection] Error limpiando lecciones:', e);
        return false;
    }
};
