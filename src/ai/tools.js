import axios from 'axios';
import SpotifyWebApi from 'spotify-web-api-node';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';

// Configuración de Spotify
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:8080/callback'
});
// Nota: Requiere un accessToken válido configurado posteriormente

export const atlasTools = [
    {
        type: 'function',
        function: {
            name: 'save_secret_note',
            description: 'Guarda una nota, un recordatorio o un texto importante en la base de datos de la nube (Laravel).',
            parameters: {
                type: 'object',
                properties: { note: { type: 'string' } },
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
                properties: { location: { type: 'string' } },
                required: ['location']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'play_music',
            description: 'Busca y reproduce una canción, artista o playlist en Spotify.',
            parameters: {
                type: 'object',
                properties: { query: { type: 'string', description: 'Nombre de la canción o artista' } },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'control_home_device',
            description: 'Enciende o apaga un dispositivo domótico (luces, enchufes) a través de Home Assistant.',
            parameters: {
                type: 'object',
                properties: {
                    entity_id: { type: 'string', description: 'El ID del dispositivo, ej. light.salon' },
                    action: { type: 'string', description: 'turn_on o turn_off' }
                },
                required: ['entity_id', 'action']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'analyze_camera',
            description: 'Toma una captura de la cámara de seguridad y usa visión artificial para decir qué está pasando.',
            parameters: {
                type: 'object',
                properties: { camera_name: { type: 'string', description: 'Nombre de la cámara, ej. puerta' } },
                required: ['camera_name']
            }
        }
    }
];

export const executeLocalTool = async (action, args) => {
    switch (action) {
        case 'get_weather':
            return await fetchWeather(args.location);
        case 'play_music':
            return await playSpotifyMusic(args.query);
        case 'control_home_device':
            return await controlHomeAssistant(args.entity_id, args.action);
        case 'analyze_camera':
            return await analyzeCamera(args.camera_name);
        default:
            return null; // Laravel
    }
};

// 1. Clima (Real Open-Meteo)
async function fetchWeather(location) {
    try {
        const geoRes = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=es`);
        if (!geoRes.data.results) return `No encontré la ciudad ${location}.`;
        const { latitude, longitude, name } = geoRes.data.results[0];
        const weatherRes = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
        return `El clima en ${name} es de ${weatherRes.data.current_weather.temperature} grados.`;
    } catch (e) {
        return `Error al consultar el clima.`;
    }
}

// 2. Música (Real Spotify API)
async function playSpotifyMusic(query) {
    if (!process.env.SPOTIFY_ACCESS_TOKEN) {
        return "El token de Spotify no está configurado en el servidor.";
    }
    try {
        spotifyApi.setAccessToken(process.env.SPOTIFY_ACCESS_TOKEN);
        const search = await spotifyApi.searchTracks(query, { limit: 1 });
        if (search.body.tracks.items.length === 0) return `No encontré la canción ${query} en Spotify.`;
        
        const track = search.body.tracks.items[0];
        // Enviar la orden de reproducir al dispositivo activo
        await spotifyApi.play({ uris: [track.uri] });
        return `Reproduciendo ${track.name} de ${track.artists[0].name} en Spotify.`;
    } catch (e) {
        console.error('[Tools] Spotify Error:', e.message);
        return `Ocurrió un error al intentar poner música en Spotify. Asegúrate de tener un dispositivo activo.`;
    }
}

// 3. Domótica (Real Home Assistant)
async function controlHomeAssistant(entity_id, action) {
    const HA_URL = process.env.HA_URL; // ej: http://192.168.1.100:8123
    const HA_TOKEN = process.env.HA_TOKEN;

    if (!HA_URL || !HA_TOKEN) return "Home Assistant no está configurado en el entorno.";

    try {
        const domain = entity_id.split('.')[0]; // 'light' de 'light.salon'
        await axios.post(`${HA_URL}/api/services/${domain}/${action}`, 
            { entity_id: entity_id },
            { headers: { 'Authorization': `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        return `He ${action === 'turn_on' ? 'encendido' : 'apagado'} el dispositivo ${entity_id} correctamente.`;
    } catch (e) {
        console.error('[Tools] HA Error:', e.message);
        return `Error al controlar la domótica. Revisa la conexión con Home Assistant.`;
    }
}

// 4. Visión (Captura RTSP + Ollama multimodal)
async function analyzeCamera(cameraName) {
    const rtspUrl = process.env.CAMERA_RTSP_URL; // RTSP stream URL
    if (!rtspUrl) return "La URL de la cámara no está configurada.";

    return new Promise((resolve) => {
        const tempImg = path.join(process.cwd(), 'temp_frame.jpg');
        console.log(`[Tools] Capturando fotograma RTSP de ${cameraName}...`);
        
        // Usa ffmpeg para extraer 1 frame
        ffmpeg(rtspUrl)
            .outputOptions(['-vframes 1', '-q:v 2'])
            .output(tempImg)
            .on('end', async () => {
                try {
                    // Pasar la imagen a un modelo visual (ej: llava o qwen-vl)
                    // TODO: Necesitamos que qwen.js esté preparado para multimodalidad.
                    // Por ahora le devolvemos una respuesta de éxito técnica.
                    resolve("He analizado la cámara. (Requiere cargar Qwen-VL para devolver la descripción visual).");
                } catch(e) {
                    resolve("Error analizando la imagen de la cámara.");
                }
            })
            .on('error', (err) => {
                console.error('[Tools] FFmpeg Error:', err.message);
                resolve("No pude acceder al feed de la cámara de seguridad.");
            })
            .run();
    });
}
