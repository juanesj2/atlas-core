import SpotifyWebApi from 'spotify-web-api-node';
import fs from 'fs';
import path from 'path';

const TOKEN_PATH = path.join(process.cwd(), 'spotify_tokens.json');

// ================= SPOTIFY CONFIG =================
let spotifyApi;

function initSpotify() {
    if (!spotifyApi) {
        spotifyApi = new SpotifyWebApi({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            redirectUri: `http://localhost:${process.env.PORT || 8080}/spotify/callback`
        });

        // Intentar cargar tokens previos
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
    }
    return spotifyApi;
}

async function ensureSpotifyToken() {
    const api = initSpotify();
    if (!api.getRefreshToken()) return false;
    try {
        const data = await api.refreshAccessToken();
        api.setAccessToken(data.body['access_token']);
        
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

export const definition = {
    type: 'function',
    function: {
        name: 'play_music',
        description: 'Reproduce una canción o playlist específica en Spotify.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Nombre de la canción o artista a reproducir' }
            },
            required: ['query']
        }
    }
};

export const execute = async (args) => {
    if (!await ensureSpotifyToken()) {
        return "No tengo permiso para usar Spotify. Dile al usuario que entre en http://localhost:8080/spotify/login para autorizarme.";
    }
    
    try {
        const api = initSpotify();
        const search = await api.searchTracks(args.query, { limit: 1 });
        if (search.body.tracks.items.length === 0) return `No encontré la canción ${args.query} en Spotify.`;
        
        const track = search.body.tracks.items[0];
        await api.play({ uris: [track.uri] });
        return `Reproduciendo ${track.name} de ${track.artists[0].name} en Spotify.`;
    } catch (e) {
        console.error('[Tools] Spotify Error:', e.message);
        return `Ocurrió un error al intentar poner música en Spotify. Asegúrate de tener la app de Spotify abierta en algún dispositivo activo.`;
    }
};
