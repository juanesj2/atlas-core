import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import https from 'https';
import { WebSocketServer } from 'ws';
import { handleSatelliteConnection } from './socket/satellite.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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
        // Recargar el registro de skills
        await loadSkills();
        res.json({ success: true, newFilename });
    } catch (e) {
        console.error(e);
        res.status(500).send('Error modificando la skill');
    }
});

// Endpoint Proactivo: Permite que sensores externos (HA) hagan hablar a Atlas
import { broadcastVoiceMessage } from './socket/satellite.js';
import { askAtlas } from './ai/qwen.js';

app.post('/api/trigger', async (req, res) => {
    const { event, context, username } = req.body || {};
    
    if (!event) return res.status(400).json({ error: 'Falta el campo event' });

    console.log(`[API] ⚡ Disparo Proactivo recibido: ${event}`);
    
    const internalPrompt = `EVENTO DEL SISTEMA (Responde proactivamente): El sistema domótico ha detectado un evento llamado '${event}'. 
    Contexto adicional: ${context || 'Ninguno'}.
    Genera un comentario natural de 1 o 2 frases hacia el usuario informando de esto, o dándole los buenos días si aplica. No expliques que eres una IA, simplemente díselo de forma natural.`;
    
    try {
        const response = await askAtlas(internalPrompt, [], username || 'Juanes');
        
        // Transmitir a todos los altavoces de la casa
        await broadcastVoiceMessage(response.text, 'female');
        
        res.json({ success: true, message: 'Mensaje transmitido a los satélites', text: response.text });
    } catch (e) {
        console.error('[API] Error en evento proactivo:', e);
        res.status(500).json({ error: 'Error procesando el evento' });
    }
});

// === API GESTOR DE RUTINAS ===
import { loadRoutines, getRoutines, addRoutine, deleteRoutine, toggleRoutine, editRoutine } from './ai/routineManager.js';

app.get('/api/routines', (req, res) => {
    res.json(getRoutines());
});

app.post('/api/routines', (req, res) => {
    const { name, cronExpression, prompt, username } = req.body;
    if (!name || !cronExpression || !prompt) return res.status(400).json({ error: 'Faltan parámetros' });
    
    const r = addRoutine(name, cronExpression, prompt, username);
    res.json({ success: true, routine: r });
});

app.put('/api/routines/:id', (req, res) => {
    const { name, cronExpression, prompt, username } = req.body;
    if (!name || !cronExpression || !prompt) return res.status(400).json({ error: 'Faltan parámetros' });
    
    const r = editRoutine(req.params.id, name, cronExpression, prompt, username);
    res.json({ success: r !== null, routine: r });
});

app.delete('/api/routines/:id', (req, res) => {
    const success = deleteRoutine(req.params.id);
    res.json({ success });
});

app.post('/api/routines/:id/toggle', (req, res) => {
    const success = toggleRoutine(req.params.id, req.body.active);
    res.json({ success });
});

// Cargar rutinas y skills en el arranque
await loadSkills();
loadRoutines();

// ===========================================

const server = createServer(app);

console.log('='.repeat(40));
console.log('🚀 ATLAS Gateway Initializing...');
console.log(`🤖 MOCK_AI Mode: ${MOCK_AI ? '🟢 ACTIVE' : '🔴 INACTIVE'}`);
console.log('='.repeat(40));

// Inicialización del servidor WebSocket anclado al servidor HTTP de Express
const wss = new WebSocketServer({ server });

// === API BIOMETRÍA Y PERFILES DE VOZ ===
const voiceProfilesDir = path.join(__dirname, '../voice_profiles');
if (!fs.existsSync(voiceProfilesDir)) {
    fs.mkdirSync(voiceProfilesDir, { recursive: true });
}

// Listar perfiles existentes
app.get('/api/voice-profiles', (req, res) => {
    try {
        const files = fs.readdirSync(voiceProfilesDir)
            .filter(f => f.endsWith('.wav'))
            .map(f => {
                const rawName = f.replace('.wav', '').replace(/_/g, ' ');
                const stat = fs.statSync(path.join(voiceProfilesDir, f));
                return {
                    id: f.replace('.wav', ''),
                    name: rawName.charAt(0).toUpperCase() + rawName.slice(1),
                    filename: f,
                    size: stat.size,
                    createdAt: stat.mtime
                };
            });
        res.json({ profiles: files });
    } catch (e) {
        console.error('[Biometrics] Error listando perfiles:', e);
        res.status(500).json({ error: 'Error listando perfiles de voz' });
    }
});

// Registrar o actualizar un perfil de voz con audio Base64
app.post('/api/voice-profiles/enroll', (req, res) => {
    try {
        const { name, audioBase64 } = req.body || {};
        if (!name || !audioBase64) {
            return res.status(400).json({ error: 'Nombre y audio requeridos' });
        }

        const safeName = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "_");
        const filePath = path.join(voiceProfilesDir, `${safeName}.wav`);
        
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        fs.writeFileSync(filePath, audioBuffer);
        console.log(`[Biometrics] 👤 Nuevo perfil de voz guardado: ${safeName}.wav (${audioBuffer.length} bytes)`);

        res.json({ success: true, name: safeName, size: audioBuffer.length });
    } catch (e) {
        console.error('[Biometrics] Error guardando perfil:', e);
        res.status(500).json({ error: 'Error guardando perfil de voz' });
    }
});

// Eliminar un perfil
app.delete('/api/voice-profiles/:id', (req, res) => {
    try {
        const safeName = req.params.id.replace(/[^a-z0-9_]/gi, '');
        const filePath = path.join(voiceProfilesDir, `${safeName}.wav`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[Biometrics] 🗑️ Perfil eliminado: ${safeName}.wav`);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Error eliminando perfil' });
    }
});

// Verificar audio contra perfiles (Identificación biométrica)
app.post('/api/voice-profiles/identify', async (req, res) => {
    try {
        const { audioBase64 } = req.body || {};
        if (!audioBase64) {
            return res.status(400).json({ error: 'Audio requerido' });
        }

        const tempIncoming = path.join(__dirname, '../temp_identify.wav');
        fs.writeFileSync(tempIncoming, Buffer.from(audioBase64, 'base64'));

        // Consultar el microservicio de biometría en Python
        try {
            const pyRes = await fetch('http://127.0.0.1:8000/process_audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filepath: tempIncoming })
            });

            if (pyRes.ok) {
                const data = await pyRes.json();
                try { fs.unlinkSync(tempIncoming); } catch (e) {}
                return res.json({ success: true, user: data.user, score: data.score, text: data.text });
            }
        } catch (err) {
            console.warn('[Biometrics] Microservicio Python no disponible:', err.message);
        }

        try { fs.unlinkSync(tempIncoming); } catch (e) {}
        res.json({ success: false, user: 'invitado', message: 'Servidor biométrico no activo' });
    } catch (e) {
        console.error('[Biometrics] Error en identificación:', e);
        res.status(500).json({ error: 'Error procesando biometría' });
    }
});

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

// === SERVIDOR HTTPS (Permite usar el micrófono desde tablets/móviles por WiFi) ===
const sslKeyPath = path.join(__dirname, '../ssl/key.pem');
const sslCertPath = path.join(__dirname, '../ssl/cert.pem');
if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
    try {
        const httpsServer = https.createServer({
            key: fs.readFileSync(sslKeyPath),
            cert: fs.readFileSync(sslCertPath)
        }, app);

        const wssHttps = new WebSocketServer({ server: httpsServer });
        wssHttps.on('connection', (ws, req) => {
            const clientIp = req.socket.remoteAddress;
            console.log(`🔌 [HTTPS/WSS] Satellite / Web client connected from ${clientIp}`);
            handleSatelliteConnection(ws);
        });

        wssHttps.on('error', (error) => {
            console.error('❌ WSS (HTTPS) Error:', error);
        });

        const HTTPS_PORT = process.env.HTTPS_PORT || 8443;
        httpsServer.listen(HTTPS_PORT, () => {
            console.log(`🔒 HTTPS Server running on https://localhost:${HTTPS_PORT} (o https://192.168.1.43:${HTTPS_PORT})`);
        });
    } catch (e) {
        console.warn('⚠️ No se pudo iniciar el servidor HTTPS:', e.message);
    }
}

