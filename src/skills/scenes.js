import { execute as controlHomeAssistant } from './home_assistant.js';
import { execute as playSpotifyMusic } from './spotify.js';

export const definition = {
    type: 'function',
    function: {
        name: 'set_scene',
        description: 'Activa una escena predefinida en la casa (Modo Cine, Modo Noche, Modo Fiesta) que controla varios dispositivos a la vez.',
        parameters: {
            type: 'object',
            properties: { 
                scene_name: { type: 'string', description: 'El nombre de la escena, ej. cine, noche, fiesta' } 
            },
            required: ['scene_name']
        }
    }
};

export const execute = async (args) => {
    console.log(`[Tools] Activando escena: ${args.scene_name}`);
    const lowerScene = args.scene_name.toLowerCase();
    
    if (lowerScene.includes('cine')) {
        await controlHomeAssistant({ entity_id: 'light.salon', action: 'turn_off' });
        return "Escena Modo Cine activada. He atenuado las luces para la película.";
    } else if (lowerScene.includes('noche') || lowerScene.includes('dormir')) {
        await controlHomeAssistant({ entity_id: 'light.todas', action: 'turn_off' });
        return "Escena Modo Noche activada. Todas las luces de la casa están apagadas.";
    } else if (lowerScene.includes('fiesta')) {
        await playSpotifyMusic({ query: 'Música de Fiesta' });
        return "Escena Fiesta activada. Música en marcha y ambiente preparado.";
    } else {
        return `No tengo programada la escena ${args.scene_name}, pero dímelo si quieres que la cree.`;
    }
};
