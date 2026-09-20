import { addRoutine } from '../ai/routineManager.js';

export const definition = {
    type: 'function',
    function: {
        name: 'crear_rutina',
        description: 'Programa una rutina o recordatorio para el usuario en una hora o patrón específico usando formato cron.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Nombre corto de la rutina, ej: "Regar plantas", "Pastilla"' },
                cronExpression: { type: 'string', description: 'Expresión cron válida (minuto hora día mes día_semana). Ej: "0 20 * * *" para las 8PM todos los días. "30 9 * * *" para las 9:30AM.' },
                prompt: { type: 'string', description: 'Lo que le debes decir al usuario cuando se active la alarma. Ej: "Es hora de tomar tu pastilla para la tensión."' },
                username: { type: 'string', description: 'El nombre del usuario al que le pones la rutina' }
            },
            required: ['name', 'cronExpression', 'prompt', 'username']
        }
    }
};

export const execute = async (args) => {
    try {
        const routine = addRoutine(args.name, args.cronExpression, args.prompt, args.username);
        return `He programado la rutina "${args.name}" correctamente con el patrón cron "${args.cronExpression}". Dile al usuario que ya está programada y que puede verla en su Gestor de Rutinas en la web.`;
    } catch (e) {
        return `Error al programar la rutina: ${e.message}`;
    }
};
