import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import ollama from 'ollama';

export const definition = {
    type: 'function',
    function: {
        name: 'analyze_camera',
        description: 'Se conecta a una cámara de seguridad RTSP y analiza qué está pasando usando visión artificial.',
        parameters: {
            type: 'object',
            properties: {
                camera_name: { type: 'string', description: 'Nombre de la cámara (ej. salon, puerta)' }
            },
            required: ['camera_name']
        }
    }
};

export const execute = async (args) => {
    const rtspUrl = process.env.CAMERA_RTSP_URL;
    if (!rtspUrl) return "La URL de la cámara no está configurada en .env.";

    return new Promise((resolve) => {
        const tempImgPath = path.join(process.cwd(), 'temp_frame.jpg');
        console.log(`[Tools] Capturando fotograma RTSP de ${args.camera_name}...`);
        
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
                        model: 'llava',
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
};
