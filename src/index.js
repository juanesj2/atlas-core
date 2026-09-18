import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { handleSatelliteConnection } from './socket/satellite.js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const MOCK_AI = process.env.MOCK_AI === 'true';

const app = express();
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json()); // Permitir JSON body

// === API GESTOR DE SKILLS ===
import { loadSkills } from './ai/tools.js';

app.get('/api/skills', (req, res) => {
    const skillsDir = path.join(__dirname, 'skills');
    if (!fs.existsSync(skillsDir)) return res.json([]);

    const allFiles = fs.readdirSync(skillsDir);
    const skillsList = allFiles
        .filter(f => f.endsWith('.js') || f.endsWith('.disabled'))
        .map(f => {
            return {
                filename: f,
                name: f.replace('.js', '').replace('.disabled', ''),
                active: f.endsWith('.js')
            };
        });
    res.json(skillsList);
});

app.post('/api/skills/toggle', async (req, res) => {
    const { filename, activate } = req.body;
    const skillsDir = path.join(__dirname, 'skills');
    
    const currentPath = path.join(skillsDir, filename);
    if (!fs.existsSync(currentPath)) return res.status(404).send('Archivo no encontrado');

    const newFilename = activate ? filename.replace('.disabled', '') : filename + '.disabled';
    const newPath = path.join(skillsDir, newFilename);

    try {
        fs.renameSync(currentPath, newPath);
        await loadSkills(); // Recargar el cerebro de Qwen en caliente
        res.json({ success: true, newFilename, active: activate });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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

// === FLUJO DE AUTENTICACIÓN DE SPOTIFY ===
// Para que Atlas pueda controlar tu música, necesita permisos tuyos
app.get('/spotify/login', (req, res) => {
    const scope = 'user-read-playback-state user-modify-playback-state';
    const client_id = process.env.SPOTIFY_CLIENT_ID;
    const redirect_uri = `http://localhost:${PORT}/spotify/callback`;
    
    if (!client_id) return res.send('Falta SPOTIFY_CLIENT_ID en el .env');

    const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${client_id}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(redirect_uri)}`;
    res.redirect(authUrl);
});

app.get('/spotify/callback', async (req, res) => {
    const code = req.query.code || null;
    const client_id = process.env.SPOTIFY_CLIENT_ID;
    const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
    const redirect_uri = `http://localhost:${PORT}/spotify/callback`;

    if (!code) return res.send('Error: No se recibió código de Spotify');

    try {
        const authOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
            },
            body: new URLSearchParams({
                code: code,
                redirect_uri: redirect_uri,
                grant_type: 'authorization_code'
            })
        };

        const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
        const data = await response.json();

        if (data.access_token) {
            // Guardamos los tokens en un archivo local
            const fs = await import('fs');
            const path = await import('path');
            const tokenPath = path.join(process.cwd(), 'spotify_tokens.json');
            fs.writeFileSync(tokenPath, JSON.stringify(data, null, 2));
            res.send('<h1>¡Éxito!</h1><p>Spotify autorizado correctamente. Ya puedes cerrar esta ventana.</p>');
        } else {
            res.send('Error en la autorización: ' + JSON.stringify(data));
        }
    } catch (error) {
        res.send('Error conectando con Spotify: ' + error.message);
    }
});

// Arrancar el servidor
server.listen(PORT, () => {
    console.log(`🌍 Web Simulator running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket server running on ws://localhost:${PORT}`);
    console.log(`🎵 Spotify Login: http://localhost:${PORT}/spotify/login`);
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
