import axios from 'axios';

export const definition = {
    type: 'function',
    function: {
        name: 'control_home_device',
        description: 'Controla un dispositivo inteligente a través de Home Assistant.',
        parameters: {
            type: 'object',
            properties: {
                entity_id: { type: 'string', description: 'El ID de la entidad, ej. light.salon' },
                action: { type: 'string', description: 'La acción a realizar: turn_on, turn_off, toggle', enum: ['turn_on', 'turn_off', 'toggle'] }
            },
            required: ['entity_id', 'action']
        }
    }
};

export const execute = async (args) => {
    const HA_URL = process.env.HA_URL; 
    const HA_TOKEN = process.env.HA_TOKEN;

    if (!HA_URL || !HA_TOKEN) return "Home Assistant no está configurado en el servidor.";

    try {
        const domain = args.entity_id.split('.')[0]; 
        await axios.post(`${HA_URL}/api/services/${domain}/${args.action}`, 
            { entity_id: args.entity_id },
            { headers: { 'Authorization': `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        return `He ${args.action === 'turn_on' ? 'encendido' : (args.action === 'turn_off' ? 'apagado' : 'alternado')} el dispositivo ${args.entity_id} correctamente.`;
    } catch (e) {
        console.error('[Tools] HA Error:', e.message);
        return `Error al controlar la domótica. Revisa la conexión con Home Assistant.`;
    }
};

/**
 * Obtiene el estado general de la casa (temperaturas, ventanas, luces principales) de fondo.
 */
export const getEnvironmentContext = async () => {
    const HA_URL = process.env.HA_URL; 
    const HA_TOKEN = process.env.HA_TOKEN;

    if (!HA_URL || !HA_TOKEN) return "Estado Domótico: Desconocido (HA no configurado)";

    try {
        const res = await axios.get(`${HA_URL}/api/states`, {
            headers: { 'Authorization': `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' },
            timeout: 2000 // Rápido, no queremos retrasar a Atlas
        });

        // Filtrar entidades relevantes
        const states = res.data;
        const relevant = states.filter(s => 
            s.entity_id.startsWith('climate.') || 
            s.entity_id.startsWith('weather.') ||
            (s.entity_id.startsWith('sensor.') && (s.entity_id.includes('temperature') || s.entity_id.includes('humidity'))) ||
            (s.entity_id.startsWith('light.') && s.state === 'on')
        ).slice(0, 15); // Max 15 para no petar el prompt

        let contextStr = "Contexto Ambiental Actual:\n";
        relevant.forEach(s => {
            const name = s.attributes.friendly_name || s.entity_id;
            contextStr += `- ${name}: ${s.state}\n`;
        });
        
        if (relevant.length === 0) contextStr += "Todo parece normal, ninguna luz encendida ni clima activo detectado.";
        
        return contextStr;
    } catch (e) {
        console.error('[HA Context] Error obteniendo contexto ambiental:', e.message);
        return "Estado Domótico: Desconocido (Error de conexión)";
    }
};
