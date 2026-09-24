import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { askCronos } from './qwen.js';
import { broadcastVoiceMessage } from '../socket/satellite.js';
import { runLearningCycle } from './autoLearner.js';
import { runCuriosityExploration } from './curiosityEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROUTINES_FILE = path.join(__dirname, '../../Cronos_routines.json');

let routines = [];
let activeJobs = {}; // Guarda la referencia a las tareas de node-cron por ID

// Cargar rutinas desde disco
export const loadRoutines = () => {
    if (fs.existsSync(ROUTINES_FILE)) {
        try {
            routines = JSON.parse(fs.readFileSync(ROUTINES_FILE, 'utf-8'));
        } catch (e) {
            console.error('[Routines] Error leyendo rutinas:', e);
            routines = [];
        }
    } else {
        routines = [];
    }
    
    // Reiniciar jobs
    Object.values(activeJobs).forEach(job => job.stop());
    activeJobs = {};

    // Iniciar rutinas activas
    routines.forEach(routine => {
        if (routine.active) {
            scheduleRoutine(routine);
        }
    });

    // Programar el ciclo nocturno de aprendizaje profundo y curiosidad (todos los días a las 04:00 AM)
    activeJobs['Cronos_nightly_learning'] = cron.schedule('0 4 * * *', async () => {
        console.log('[Routines] 🌌 Iniciando ciclo nocturno de aprendizaje y exploración...');
        try {
            await runLearningCycle();
            await runCuriosityExploration(2);
        } catch (err) {
            console.error('[Routines] Error en ciclo nocturno:', err.message);
        }
    });
    console.log('[Routines] 🌙 Ciclo nocturno de autoaprendizaje programado (04:00 AM).');
    
    console.log(`[Routines] ${routines.length} rutinas cargadas.`);
};

// Programar una rutina con node-cron
const scheduleRoutine = (routine) => {
    if (!cron.validate(routine.cronExpression)) {
        console.error(`[Routines] Expresión cron inválida para ${routine.id}: ${routine.cronExpression}`);
        return;
    }

    const job = cron.schedule(routine.cronExpression, async () => {
        console.log(`[Routines] ⏰ Disparando rutina: ${routine.name}`);
        
        const internalPrompt = `EVENTO DE RUTINA AUTOMÁTICA: Es el momento de ejecutar la rutina llamada "${routine.name}".
        Instrucciones de la rutina: "${routine.prompt}"
        IMPORTANTE: Si las instrucciones implican controlar la domótica (encender luces, cafetera, etc) o buscar información (el tiempo), DEBES usar tus herramientas (tools) para hacerlo AHORA. 
        Tras ejecutar las acciones necesarias, genera un comentario natural y proactivo hacia el usuario. No expliques que eres una IA.`;
        
        try {
            const response = await askCronos(internalPrompt, [], routine.username || 'Juanes');
            await broadcastVoiceMessage(response.text, 'female');
        } catch (e) {
            console.error('[Routines] Error ejecutando rutina:', e);
        }
    });

    activeJobs[routine.id] = job;
};

// Obtener todas
export const getRoutines = () => routines;

// Añadir nueva
export const addRoutine = (name, cronExpression, prompt, username = 'Juanes') => {
    const id = Date.now().toString();
    const newRoutine = {
        id,
        name,
        cronExpression,
        prompt,
        username,
        active: true
    };
    
    routines.push(newRoutine);
    fs.writeFileSync(ROUTINES_FILE, JSON.stringify(routines, null, 2));
    
    scheduleRoutine(newRoutine);
    return newRoutine;
};

// Eliminar rutina
export const deleteRoutine = (id) => {
    const index = routines.findIndex(r => r.id === id);
    if (index !== -1) {
        if (activeJobs[id]) {
            activeJobs[id].stop();
            delete activeJobs[id];
        }
        routines.splice(index, 1);
        fs.writeFileSync(ROUTINES_FILE, JSON.stringify(routines, null, 2));
        return true;
    }
    return false;
};

// Pausar/Reanudar rutina
export const toggleRoutine = (id, active) => {
    const routine = routines.find(r => r.id === id);
    if (routine) {
        routine.active = active;
        if (active) {
            scheduleRoutine(routine);
        } else if (activeJobs[id]) {
            activeJobs[id].stop();
            delete activeJobs[id];
        }
        fs.writeFileSync(ROUTINES_FILE, JSON.stringify(routines, null, 2));
        return true;
    }
    return false;
};

// Editar rutina
export const editRoutine = (id, name, cronExpression, prompt, username) => {
    const routine = routines.find(r => r.id === id);
    if (routine) {
        routine.name = name;
        routine.cronExpression = cronExpression;
        routine.prompt = prompt;
        routine.username = username || routine.username;
        
        // Si estaba activa, reprogramarla con la nueva configuración
        if (routine.active) {
            if (activeJobs[id]) {
                activeJobs[id].stop();
                delete activeJobs[id];
            }
            scheduleRoutine(routine);
        }
        
        fs.writeFileSync(ROUTINES_FILE, JSON.stringify(routines, null, 2));
        return routine;
    }
    return null;
};
