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
