import SpotifyWebApi from 'spotify-web-api-node';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_PATH = path.resolve(__dirname, '../../spotify_tokens.json');

/**
 * Envoltorio para evitar bloqueos indefinidos en la API de Spotify
 */
function withTimeout(promise, ms = 4000, errorMsg = 'Spotify no respondió a tiempo') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
    ]);
}

// ================= SPOTIFY CONFIG =================
let spotifyApi;

function initSpotify() {
    if (!spotifyApi) {
        spotifyApi = new SpotifyWebApi({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            redirectUri: process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${process.env.PORT || 8080}/spotify/callback`
        });

        reloadSpotifyTokens();
    }
    return spotifyApi;
}

let tokenExpiresAt = 0;

export function reloadSpotifyTokens() {
    if (!fs.existsSync(TOKEN_PATH)) return false;
    try {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        if (!spotifyApi) {
            spotifyApi = new SpotifyWebApi({
                clientId: process.env.SPOTIFY_CLIENT_ID,
                clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
                redirectUri: process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${process.env.PORT || 8080}/spotify/callback`
            });
        }
        if (tokens.access_token) spotifyApi.setAccessToken(tokens.access_token);
        if (tokens.refresh_token) spotifyApi.setRefreshToken(tokens.refresh_token);
        if (tokens.expires_at) {
            tokenExpiresAt = tokens.expires_at;
        } else if (tokens.expires_in) {
            tokenExpiresAt = Date.now() + (tokens.expires_in * 1000);
        }
        console.log('[Spotify] 🎵 Tokens cargados correctamente.');
        return true;
    } catch (e) {
        console.error('[Spotify] Error leyendo tokens:', e.message);
        return false;
    }
}

async function ensureSpotifyToken() {
    const api = initSpotify();
    if (!api.getAccessToken()) {
        if (!reloadSpotifyTokens() || !api.getAccessToken()) {
            return false;
        }
    }
    // Si el token aún es válido (con margen de 2 minutos), no necesitamos refrescar
    if (tokenExpiresAt && Date.now() < (tokenExpiresAt - 120000)) {
        return true;
    }
    // Si no tenemos refresh token, usar el access token actual
    if (!api.getRefreshToken()) return !!api.getAccessToken();

    try {
        const data = await withTimeout(api.refreshAccessToken(), 4500, 'Timeout refrescando token de Spotify');
        const newAccessToken = data.body['access_token'];
        api.setAccessToken(newAccessToken);
        tokenExpiresAt = Date.now() + ((data.body['expires_in'] || 3600) * 1000);
        
        if (fs.existsSync(TOKEN_PATH)) {
            const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
            currentTokens.access_token = newAccessToken;
            currentTokens.expires_at = tokenExpiresAt;
            if (data.body['refresh_token']) currentTokens.refresh_token = data.body['refresh_token'];
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(currentTokens, null, 2));
        }
        return true;
    } catch (e) {
        console.warn('[Spotify] Advertencia refrescando token:', e.message);
        return !!api.getAccessToken();
    }
}

/**
 * Busca un dispositivo de reproducción activo o disponible
 */
async function getTargetDeviceId(api, requestedDeviceName) {
    try {
        const devicesRes = await withTimeout(api.getMyDevices(), 3500, 'Timeout obteniendo dispositivos');
        const devices = devicesRes.body.devices || [];
        if (devices.length === 0) return null;

        // Si el usuario pidió un dispositivo concreto, buscamos el que mejor coincida
        if (requestedDeviceName) {
            const req = requestedDeviceName.toLowerCase();
            const matchedDevice = devices.find(d => d.name.toLowerCase().includes(req));
            if (matchedDevice) {
                try {
                    await withTimeout(api.transferMyPlayback([matchedDevice.id], { play: false }), 2000);
                } catch (err) {}
                return matchedDevice.id;
            }
        }

        const activeDevice = devices.find(d => d.is_active);
        if (activeDevice) return activeDevice.id;

        // Si no hay ninguno activo, buscar dispositivo de Juanes o el primero
        const preferred = devices.find(d => d.name.toLowerCase().includes('juan') && !d.name.toLowerCase().includes('daniela')) || devices[0];
        
        // Despertar el dispositivo transfiriendo la reproducción
        try {
            await withTimeout(api.transferMyPlayback([preferred.id], { play: false }), 2000);
        } catch (err) {}

        return preferred.id;
    } catch (e) {
        console.warn('[Spotify] No se pudieron obtener dispositivos:', e.message);
        return null;
    }
}

export async function getSpotifyStatus() {
    if (!fs.existsSync(TOKEN_PATH)) {
        return { connected: false, message: 'Spotify no está vinculado. Accede a /spotify/login' };
    }
    try {
        const ok = await ensureSpotifyToken();
        if (!ok) return { connected: false, message: 'Token expirado o inválido' };

        const api = initSpotify();
        const [meRes, devicesRes, currentTrack] = await Promise.all([
            withTimeout(api.getMe(), 2500).catch(() => null),
            withTimeout(api.getMyDevices(), 2500).catch(() => ({ body: { devices: [] } })),
            withTimeout(api.getMyCurrentPlayingTrack(), 2500).catch(() => null)
        ]);

        const user = meRes ? (meRes.body.display_name || meRes.body.id) : 'Usuario Spotify';
        const devices = devicesRes?.body?.devices || [];
        const isPlaying = currentTrack?.body?.is_playing || false;
        const trackName = currentTrack?.body?.item ? `${currentTrack.body.item.name} - ${currentTrack.body.item.artists[0]?.name}` : null;

        return {
            connected: true,
            user,
            devices: devices.map(d => ({ id: d.id, name: d.name, type: d.type, isActive: d.is_active })),
            isPlaying,
            currentTrack: trackName
        };
    } catch (e) {
        return { connected: false, error: e.message };
    }
}

export const definition = {
    type: 'function',
    function: {
        name: 'play_music',
        description: 'Controla la reproducción de música en Spotify: buscar y reproducir canciones/artistas/playlists, pausar o parar música, reanudar, pasar de canción, volver a la anterior, ajustar el volumen o saber qué canción suena.',
        parameters: {
            type: 'object',
            properties: {
                action: { 
                    type: 'string', 
                    enum: ['play', 'pause', 'resume', 'next', 'previous', 'volume', 'current'],
                    description: 'Acción a ejecutar: "play" para reproducir o buscar música, "pause" para pausar/parar la reproducción, "resume" para reanudar, "next" para pasar a la siguiente pista, "previous" para la anterior pista, "volume" para cambiar el volumen, "current" para consultar qué canción está sonando.' 
                },
                query: { 
                    type: 'string', 
                    description: 'Nombre de la canción, artista o playlist a reproducir (usado si action="play").' 
                },
                volume_percent: {
                    type: 'integer',
                    description: 'Nivel de volumen entre 0 y 100 (usado si action="volume" con valor específico).'
                },
                volume_direction: {
                    type: 'string',
                    enum: ['up', 'down'],
                    description: 'Dirección para subir ("up") o bajar ("down") el volumen relativo si no se especifica porcentaje.'
                },
                device_name: {
                    type: 'string',
                    description: 'Nombre del altavoz o dispositivo donde reproducir (ej. "Echo Dot de Daniela", "Salón", "ordenador"). Si no se especifica, usará el dispositivo por defecto.'
                }
            },
            required: ['action']
        }
    }
};

export const execute = async (args = {}) => {
    if (!await ensureSpotifyToken()) {
        const port = process.env.PORT || 8080;
        const ip = process.env.SERVER_IP || '192.168.1.161';
        return `No tengo permiso para usar Spotify todavía. Por favor, entra en http://${ip}:${port}/spotify/login para vincular tu cuenta de Spotify con Cronos.`;
    }
    
    const api = initSpotify();
    const action = (args.action || (args.query ? 'play' : 'resume')).toLowerCase().trim();

    try {
        const deviceId = await getTargetDeviceId(api, args.device_name);

        // 1. ACCIÓN: PAUSAR / PARAR
        if (action === 'pause' || action === 'stop') {
            await withTimeout(api.pause({ device_id: deviceId || undefined }), 3000);
            return "Música pausada en Spotify.";
        }

        // 2. ACCIÓN: REANUDAR
        if (action === 'resume') {
            await withTimeout(api.play({ device_id: deviceId || undefined }), 3000);
            return "Música reanudada en Spotify.";
        }

        // 3. ACCIÓN: SIGUIENTE CANCIÓN
        if (action === 'next') {
            await withTimeout(api.skipToNext({ device_id: deviceId || undefined }), 3000);
            return "Pasando a la siguiente canción en Spotify.";
        }

        // 4. ACCIÓN: CANCIÓN ANTERIOR
        if (action === 'previous') {
            await withTimeout(api.skipToPrevious({ device_id: deviceId || undefined }), 3000);
            return "Volviendo a la canción anterior en Spotify.";
        }

        // 5. ACCIÓN: VOLUMEN
        if (action === 'volume') {
            const devicesRes = await withTimeout(api.getMyDevices(), 2500).catch(() => ({ body: { devices: [] } }));
            const devices = devicesRes?.body?.devices || [];
            const targetDev = devices.find(d => d.id === deviceId) || devices.find(d => d.is_active) || devices[0];

            if (targetDev && targetDev.supports_volume === false) {
                return `El dispositivo "${targetDev.name}" es un teléfono móvil. Spotify no permite modificar el volumen por API en smartphones; debes usar los botones físicos de volumen de tu teléfono.`;
            }

            let currentVol = (targetDev && typeof targetDev.volume_percent === 'number') ? targetDev.volume_percent : 50;
            let vol = parseInt(args.volume_percent);

            if (isNaN(vol)) {
                if (args.volume_direction === 'down') {
                    vol = Math.max(0, currentVol - 15);
                } else {
                    vol = Math.min(100, currentVol + 15);
                }
            }
            vol = Math.max(0, Math.min(100, vol));

            await withTimeout(api.setVolume(vol, { device_id: deviceId || undefined }), 3000);
            return `Volumen de Spotify puesto al ${vol}%.`;
        }

        // 6. ACCIÓN: CONSULTAR QUÉ CANCIÓN SUENA
        if (action === 'current' || action === 'now_playing') {
            const currentRes = await withTimeout(api.getMyCurrentPlayingTrack(), 2500);
            const item = currentRes?.body?.item;
            if (item) {
                const artists = item.artists.map(a => a.name).join(', ');
                return `Ahora mismo está sonando "${item.name}" de ${artists} en Spotify.`;
            } else {
                return "No hay ninguna canción reproduciéndose en este momento en Spotify.";
            }
        }

        // 7. ACCIÓN: REPRODUCIR (PLAY) CON O SIN QUERY
        if (action === 'play') {
            const query = (args.query || '').trim();

            // Si no especificó canción, intentar reanudar reproducción
            if (!query) {
                try {
                    await withTimeout(api.play({ device_id: deviceId || undefined }), 3000);
                    return "Reanudando música en Spotify.";
                } catch (playErr) {
                    // Si no había canción pausada (Restriction violated / no context), poner Top Éxitos
                    console.log('[Spotify] Reanudar sin cola previa. Reproduciendo lista de éxitos...');
                    const searchPlaylists = await withTimeout(api.searchPlaylists('Top Éxitos España', { limit: 1 }), 3000).catch(() => null);
                    if (searchPlaylists?.body?.playlists?.items?.length > 0) {
                        const playlist = searchPlaylists.body.playlists.items[0];
                        const playOpts = { context_uri: playlist.uri };
                        if (deviceId) playOpts.device_id = deviceId;
                        await withTimeout(api.play(playOpts), 3500);
                        return `Poniendo "${playlist.name}" en Spotify.`;
                    }
                    throw playErr;
                }
            }

            // Buscar primero como pista/canción
            const search = await withTimeout(api.searchTracks(query, { limit: 1 }), 3000).catch(() => ({ body: { tracks: { items: [] } } }));
            if (search.body.tracks && search.body.tracks.items.length > 0) {
                const track = search.body.tracks.items[0];
                const artists = track.artists.map(a => a.name).join(', ');
                const playOpts = { uris: [track.uri] };
                if (deviceId) playOpts.device_id = deviceId;
                await withTimeout(api.play(playOpts), 3500);
                return `Reproduciendo "${track.name}" de ${artists} en Spotify.`;
            }

            // Si no encontró canción, buscar playlists
            const searchPlaylists = await withTimeout(api.searchPlaylists(query, { limit: 1 }), 3000).catch(() => ({ body: { playlists: { items: [] } } }));
            if (searchPlaylists.body.playlists && searchPlaylists.body.playlists.items.length > 0) {
                const playlist = searchPlaylists.body.playlists.items[0];
                const playOpts = { context_uri: playlist.uri };
                if (deviceId) playOpts.device_id = deviceId;
                await withTimeout(api.play(playOpts), 3500);
                return `Reproduciendo la playlist "${playlist.name}" en Spotify.`;
            }

            // Si no encontró playlist, buscar álbumes
            const searchAlbums = await withTimeout(api.searchAlbums(query, { limit: 1 }), 3000).catch(() => ({ body: { albums: { items: [] } } }));
            if (searchAlbums.body.albums && searchAlbums.body.albums.items.length > 0) {
                const album = searchAlbums.body.albums.items[0];
                const playOpts = { context_uri: album.uri };
                if (deviceId) playOpts.device_id = deviceId;
                await withTimeout(api.play(playOpts), 3500);
                return `Reproduciendo el álbum "${album.name}" en Spotify.`;
            }

            return `No encontré resultados para "${query}" en Spotify.`;
        }

        return `Acción "${action}" no reconocida para Spotify.`;

    } catch (e) {
        console.error('[Spotify] Error de ejecución:', e.message);
        if (e.message && (e.message.includes('NO_ACTIVE_DEVICE') || e.message.includes('No active device') || e.message.includes('Not found'))) {
            return `No encontré ningún reproductor de Spotify activo. Abre la app de Spotify en tu móvil o altavoz y vuelve a pedírmelo.`;
        }
        if (e.message && e.message.includes('Restriction violated')) {
            return `Spotify no tiene música en cola para reanudar. Pídeme un artista o canción concreta.`;
        }
        if (e.message && e.message.includes('PREMIUM_REQUIRED')) {
            return `Esta función de Spotify requiere una cuenta Spotify Premium para controlar la reproducción remotamente.`;
        }
        if (e.message && e.message.includes('tiempo')) {
            return `Spotify tardó demasiado en responder. Comprueba que la app de Spotify esté abierta.`;
        }
        return `Ocurrió un error con Spotify. Asegúrate de tener la app abierta en algún dispositivo.`;
    }
};
