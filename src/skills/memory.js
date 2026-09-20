import { saveFact } from '../ai/memoryManager.js';

export const definition = {
    type: 'function',
    function: {
        name: 'memorize_fact',
        description: 'Usa esto cuando el usuario te cuente un detalle personal, gustos, preferencias o algo importante para guardarlo a largo plazo.',
        parameters: {
            type: 'object',
            properties: {
                username: { type: 'string', description: 'El nombre del usuario al que pertenece el dato' },
                fact: { type: 'string', description: 'El hecho a memorizar, ej. Le gusta el color azul, Su madre se llama Ana' }
            },
            required: ['username', 'fact']
        }
    }
};

export const execute = async (args) => {
    const success = await saveFact(args.username, args.fact);
    return success 
        ? `He guardado exitosamente el dato para ${args.username}.` 
        : `No pude guardar el dato (quizás el usuario es inválido o el dato ya existía).`;
};
