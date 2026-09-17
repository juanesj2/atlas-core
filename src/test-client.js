import WebSocket from 'ws';

console.log('Iniciando simulador de Satélite (ESP32)...');
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
    console.log('✅ Conectado exitosamente al Gateway ATLAS');
    
    // 1. Simulamos que el usuario dice "Hey Atlas" (Wake Word detectado en el ESP32)
    setTimeout(() => {
        console.log('🗣️ [Satélite] Usuario dijo la palabra de activación. Enviando WAKE_WORD_DETECTED...');
        ws.send(JSON.stringify({ event: 'WAKE_WORD_DETECTED' }));
    }, 1000);

    // 2. Simulamos que el usuario termina de hablar y enviamos el audio
    setTimeout(() => {
        console.log('🎤 [Satélite] Enviando stream de audio binario al Gateway...');
        // Enviamos un buffer binario (simulando los datos capturados por el micro INMP441)
        const fakeAudioBuffer = Buffer.from('audio_falso_de_prueba_simulando_voz');
        ws.send(fakeAudioBuffer);
    }, 3000);
});

// Escuchamos las instrucciones visuales que nos envía el Gateway
ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log(`\n[PANTALLA GC9A01] 📺 Actualizando UI:`);
    console.log(`  -> Estado:    ${message.state}`);
    console.log(`  -> Animación: ${message.animation}\n`);
    
    if (message.state === 'SPEAKING') {
        console.log('🔊 [Altavoz] Reproduciendo respuesta de audio del Gateway (simulado)...');
    }
});

ws.on('close', () => {
    console.log('🔌 Desconectado del Gateway');
});

ws.on('error', (error) => {
    console.error('❌ Error en el cliente WebSocket:', error.message);
});
