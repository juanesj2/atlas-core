import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { handleSatelliteConnection } from './socket/satellite.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spotifyApi } from './ai/tools.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_PATH = path.join(__dirname, '../spotify_tokens.json');

const PORT = process.env.PORT || 8080;
const MOCK_AI = process.env.MOCK_AI === 'true';

const app = express();
app.use(express.static(path.join(__dirname, '../public')));

// === RUTAS PARA AUTENTICACIÓN DE SPOTIFY ===
app.get('/spotify/login', (req, res) => {
    const scopes = ['user-read-private', 'user-read-email', 'user-modify-playback-state', 'user-read-playback-state'];
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes, 'atlas-state');
    res.redirect(authorizeURL);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    try {
        const data = await spotifyApi.authorizationCodeGrant(code);
        const { access_token, refresh_token } = data.body;
        
        // Guardar tokens en el servidor
        spotifyApi.setAccessToken(access_token);
        spotifyApi.setRefreshToken(refresh_token);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify({ access_token, refresh_token }));
        
        res.send('<h1>¡Spotify Vinculado!</h1><p>Ya puedes cerrar esta ventana y pedirle música a Atlas.</p>');
    } catch (err) {
        console.error('Error en Spotify Callback', err);
        res.status(500).send('Error vinculando Spotify.');
    }
});
// ===========================================

const server = createServer(app);

console.log('='.repeat(40));
console.log('🚀 ATLAS Gateway Initializing...');
console.log(`🤖 MOCK_AI Mode: ${MOCK_AI ? '🟢 ACTIVE' : '🔴 INACTIVE'}`);
console.log('='.repeat(40));

// Inicialización del servidor WebSocket anclado al servidor HTTP de Express
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
    console.log(`🌍 Web Simulator running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket server running on ws://localhost:${PORT}`);
});


// Manejo de conexiones entrantes de los satélites (ESP32)
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`🔌 New satellite connected from ${clientIp}`);
    
    // Delegamos la gestión del socket al módulo correspondiente
    handleSatelliteConnection(ws);
});

// Manejo de errores a nivel de servidor WebSocket
wss.on('error', (error) => {
    console.error('❌ WebSocket Server Error:', error);
});
