import axios from 'axios';
import SpotifyWebApi from 'spotify-web-api-node';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ollama from 'ollama';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_PATH = path.join(__dirname, '../../spotify_tokens.json');

// ================= SPOTIFY CONFIG =================
export const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:8080/callback'
});

// Intentar cargar tokens previos si el servidor se reinicia
if (fs.existsSync(TOKEN_PATH)) {
    try {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        spotifyApi.setAccessToken(tokens.access_token);
        spotifyApi.setRefreshToken(tokens.refresh_token);
        console.log('[Spotify] Tokens cargados desde almacenamiento local.');
    } catch (e) {
        console.error('[Spotify] Error leyendo tokens:', e.message);
    }
}

// Función para asegurar que el token es válido antes de actuar
async function ensureSpotifyToken() {
    if (!spotifyApi.getRefreshToken()) return false;
    try {
        const data = await spotifyApi.refreshAccessToken();
        spotifyApi.setAccessToken(data.body['access_token']);
        
        // Guardar el nuevo access_token (y el refresh_token si viene uno nuevo)
        const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        currentTokens.access_token = data.body['access_token'];
        if (data.body['refresh_token']) currentTokens.refresh_token = data.body['refresh_token'];
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(currentTokens));
        
        return true;
    } catch (e) {
        console.error('[Spotify] No se pudo refrescar el token:', e.message);
        return false;
    }
}
// ==================================================

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
            description: 'Enciende, apaga o cambia el estado de un dispositivo domótico (luces, enchufes) a través de Home Assistant.',
            parameters: {
                type: 'object',
                properties: {
                    entity_id: { type: 'string', description: 'El ID del dispositivo, ej. light.salon' },
                    action: { type: 'string', description: 'turn_on, turn_off o toggle' }
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
    },
    {
        type: 'function',
        function: {
            name: 'search_internet',
            description: 'Busca información general en internet usando Wikipedia. Úsalo para responder preguntas culturales, históricas, ciencia, etc.',
            parameters: {
                type: 'object',
                properties: { query: { type: 'string', description: 'El término exacto a buscar' } },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'set_scene',
            description: 'Activa una escena predefinida en la casa (Modo Cine, Modo Noche, Modo Fiesta) que controla varios dispositivos a la vez.',
            parameters: {
                type: 'object',
                properties: { scene_name: { type: 'string', description: 'El nombre de la escena, ej. cine, noche, fiesta' } },
                required: ['scene_name']
            }
        }
    }
];

export const executeLocalTool = async (action, args) => {
    switch (action) {
        case 'get_weather': return await fetchWeather(args.location);
        case 'play_music': return await playSpotifyMusic(args.query);
        case 'control_home_device': return await controlHomeAssistant(args.entity_id, args.action);
        case 'analyze_camera': return await analyzeCamera(args.camera_name);
        case 'search_internet': return await searchWikipedia(args.query);
        case 'set_scene': return await setScene(args.scene_name);
        default: return null; // Laravel
    }
};

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

async function playSpotifyMusic(query) {
    if (!await ensureSpotifyToken()) {
        return "No tengo permiso para usar Spotify. Dile al usuario que entre en http://tu-ip:8080/spotify/login para autorizarme.";
    }
    
    try {
        const search = await spotifyApi.searchTracks(query, { limit: 1 });
        if (search.body.tracks.items.length === 0) return `No encontré la canción ${query} en Spotify.`;
        
        const track = search.body.tracks.items[0];
        // Reproducir
        await spotifyApi.play({ uris: [track.uri] });
        return `Reproduciendo ${track.name} de ${track.artists[0].name} en Spotify.`;
    } catch (e) {
        console.error('[Tools] Spotify Error:', e.message);
        return `Ocurrió un error al intentar poner música en Spotify. Asegúrate de tener la app de Spotify abierta en algún dispositivo activo.`;
    }
}

async function controlHomeAssistant(entity_id, action) {
    const HA_URL = process.env.HA_URL; 
    const HA_TOKEN = process.env.HA_TOKEN;

    if (!HA_URL || !HA_TOKEN) return "Home Assistant no está configurado en el servidor.";

    try {
        const domain = entity_id.split('.')[0]; 
        await axios.post(`${HA_URL}/api/services/${domain}/${action}`, 
            { entity_id: entity_id },
            { headers: { 'Authorization': `Bearer ${HA_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        return `He ${action === 'turn_on' ? 'encendido' : (action === 'turn_off' ? 'apagado' : 'alternado')} el dispositivo ${entity_id} correctamente.`;
    } catch (e) {
        console.error('[Tools] HA Error:', e.message);
        return `Error al controlar la domótica. Revisa la conexión con Home Assistant.`;
    }
}

async function analyzeCamera(cameraName) {
    const rtspUrl = process.env.CAMERA_RTSP_URL;
    if (!rtspUrl) return "La URL de la cámara no está configurada.";

    return new Promise((resolve) => {
        const tempImgPath = path.join(process.cwd(), 'temp_frame.jpg');
        console.log(`[Tools] Capturando fotograma RTSP de ${cameraName}...`);
        
        ffmpeg(rtspUrl)
            .outputOptions(['-vframes 1', '-q:v 2'])
            .output(tempImgPath)
            .on('end', async () => {
                try {
                    console.log(`[Tools] Analizando imagen con modelo multimodal...`);
                    // Leer imagen como Base64
                    const imageBase64 = fs.readFileSync(tempImgPath, { encoding: 'base64' });
                    
                    // Llamar a Ollama usando el modelo llava o qwen-vl
                    const response = await ollama.chat({
                        model: 'llava', // Se puede cambiar a qwen-vl o el modelo de visión instalado
                        messages: [{
                            role: 'user',
                            content: 'Describe brevemente pero con detalle qué está sucediendo en esta imagen de la cámara de seguridad.',
                            images: [imageBase64]
                        }]
                    });

                    // Limpieza
                    fs.unlinkSync(tempImgPath);
                    resolve(`Análisis de la cámara: ${response.message.content}`);
                } catch(e) {
                    console.error('[Tools] Ollama Vision Error:', e.message);
                    resolve("Error procesando la imagen de la cámara. Verifica que tienes un modelo de visión como 'llava' instalado en Ollama.");
                }
            })
            .on('error', (err) => {
                console.error('[Tools] FFmpeg Error:', err.message);
                resolve("No pude acceder al feed de la cámara de seguridad. Verifica la URL RTSP.");
            })
            .run();
    });
}

// 5. Búsqueda en Internet (Wikipedia)
async function searchWikipedia(query) {
    try {
        console.log(`[Tools] Buscando en Wikipedia: ${query}`);
        const url = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`;
        const res = await axios.get(url);
        
        if (res.data.query.search.length > 0) {
            const title = res.data.query.search[0].title;
            const snippet = res.data.query.search[0].snippet.replace(/(<([^>]+)>)/gi, ""); // Limpiar HTML
            return `Encontré esto en internet sobre ${title}: ${snippet}. Resúmeselo al usuario de forma natural.`;
        } else {
            return `No encontré información sobre ${query} en internet.`;
        }
    } catch (e) {
        console.error('[Tools] Wikipedia Error:', e.message);
        return "Hubo un error de conexión al buscar en internet.";
    }
}

// 6. Orquestador de Escenas Complejas
async function setScene(sceneName) {
    console.log(`[Tools] Activando escena: ${sceneName}`);
    const lowerScene = sceneName.toLowerCase();
    
    if (lowerScene.includes('cine')) {
        await controlHomeAssistant('light.salon', 'turn_off');
        return "Escena Modo Cine activada. He atenuado las luces para la película.";
    } else if (lowerScene.includes('noche') || lowerScene.includes('dormir')) {
        await controlHomeAssistant('light.todas', 'turn_off');
        return "Escena Modo Noche activada. Todas las luces de la casa están apagadas.";
    } else if (lowerScene.includes('fiesta')) {
        await playSpotifyMusic('Música de Fiesta');
        return "Escena Fiesta activada. Música en marcha y ambiente preparado.";
    } else {
        return `No tengo programada la escena ${sceneName}, pero dímelo si quieres que la cree.`;
    }
}

