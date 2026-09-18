import axios from 'axios';

export const definition = {
    type: 'function',
    function: {
        name: 'get_weather',
        description: 'Obtiene el clima actual de cualquier ciudad.',
        parameters: {
            type: 'object',
            properties: {
                location: { type: 'string', description: 'El nombre de la ciudad' }
            },
            required: ['location']
        }
    }
};

export const execute = async (args) => {
    try {
        const geoRes = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args.location)}&count=1&language=es`);
        if (!geoRes.data.results) return `No encontré la ciudad ${args.location}.`;
        const { latitude, longitude, name } = geoRes.data.results[0];
        const weatherRes = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
        return `El clima en ${name} es de ${weatherRes.data.current_weather.temperature} grados.`;
    } catch (e) {
        return `Error al consultar el clima.`;
    }
};
