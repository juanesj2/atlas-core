// Definición de las herramientas que Qwen puede usar
export const atlasTools = [
    {
        type: 'function',
        function: {
            name: 'save_secret_note',
            description: 'Guarda una nota, un recordatorio o un texto importante en la base de datos de la nube (Laravel).',
            parameters: {
                type: 'object',
                properties: { 
                    note: { type: 'string', description: 'El contenido de la nota a guardar' } 
                },
                required: ['note']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_weather',
            description: 'Obtiene el clima actual de una ciudad o ubicación.',
            parameters: {
                type: 'object',
                properties: {
                    location: { type: 'string', description: 'Nombre de la ciudad, ej. Madrid, Bogotá' }
                },
                required: ['location']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'play_music',
            description: 'Reproduce una canción, artista o lista de reproducción en el sistema.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Nombre de la canción, artista o género a reproducir' }
                },
                required: ['query']
            }
        }
    }
];

// Ejecutor de herramientas locales (las que no van a Laravel)
export const executeLocalTool = async (action, args) => {
    switch (action) {
        case 'get_weather':
            return await fetchWeather(args.location);
        case 'play_music':
            return playMusicMock(args.query);
        default:
            return null; // Si devuelve null, significa que es una tool para Laravel u otro sistema
    }
};

// Implementación Real: Obtener clima usando la API pública gratuita de Open-Meteo
async function fetchWeather(location) {
    try {
        console.log(`[Tools] Buscando coordenadas para ${location}...`);
        // 1. Geocodificación: Obtener lat/lon de la ciudad
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=es`);
        const geoData = await geoRes.json();

        if (!geoData.results || geoData.results.length === 0) {
            return `No pude encontrar la ciudad ${location}.`;
        }

        const { latitude, longitude, name, country } = geoData.results[0];

        // 2. Obtener el clima
        console.log(`[Tools] Obteniendo clima para ${name}, ${country} (${latitude}, ${longitude})...`);
        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
        const weatherData = await weatherRes.json();

        const temp = weatherData.current_weather.temperature;
        return `El clima actual en ${name} (${country}) es de ${temp} grados centígrados.`;
    } catch (error) {
        console.error('[Tools] Error al obtener el clima:', error);
        return `Ocurrió un error al consultar el servicio meteorológico para ${location}.`;
    }
}

// Implementación Mock: Reproductor de música local
function playMusicMock(query) {
    console.log(`[Tools] 🎵 Iniciando reproducción de música: "${query}"`);
    // En un futuro, esto podría hacer una llamada HTTP a Home Assistant o lanzar un proceso de Spotify/MPD local.
    return `La reproducción de música se ha iniciado correctamente para: ${query}.`;
}
