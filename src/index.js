import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { handleSatelliteConnection } from './socket/satellite.js';

// Cargar variables de entorno
dotenv.config();

const PORT = process.env.PORT || 8080;
const MOCK_AI = process.env.MOCK_AI === 'true';

console.log('='.repeat(40));
console.log('🚀 ATLAS Gateway Initializing...');
console.log(`🤖 MOCK_AI Mode: ${MOCK_AI ? '🟢 ACTIVE' : '🔴 INACTIVE'}`);
console.log('='.repeat(40));

// Inicialización del servidor WebSocket
const wss = new WebSocketServer({ port: PORT }, () => {
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
