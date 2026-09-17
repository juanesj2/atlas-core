import dotenv from 'dotenv';
dotenv.config();

/**
 * Actúa como puente REST entre el servidor local (Core IA) y la nube (Laravel VPS).
 * Ejecuta los "Tool Calls" que el LLM genera.
 * 
 * @param {string} action - El nombre de la herramienta/acción a ejecutar (ej. 'save_secret_note')
 * @param {object} payload - Los argumentos estructurados pasados por la IA.
 * @returns {Promise<object|null>} Respuesta de Laravel o null en caso de error.
 */
export const sendCommandToLaravel = async (action, payload) => {
    const apiUrl = process.env.LARAVEL_API_URL;
    const secret = process.env.AI_BRIDGE_SECRET;

    if (!apiUrl || !secret) {
        console.warn('⚠️ [API Bridge] Faltan variables LARAVEL_API_URL o AI_BRIDGE_SECRET en .env');
        return null;
    }

    console.log(`[API Bridge] Ejecutando acción '${action}' en el VPS...`);

    try {
        // Utilizamos AbortController para prevenir cuelgues si la red o Laravel fallan
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 segundos max

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                // Validación por Token HMAC o Bearer para capa de seguridad
                'Authorization': `Bearer ${secret}`
            },
            body: JSON.stringify({ action, payload }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP Error Status: ${response.status}`);
        }

        const data = await response.json();
        console.log(`[API Bridge] ✅ Acción '${action}' completada con éxito.`, data);
        return data;

    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`[API Bridge] ❌ Timeout: El servidor Laravel tardó demasiado en responder.`);
        } else {
            console.error(`[API Bridge] ❌ Error de red conectando con la nube:`, error.message);
        }
        return null;
    }
};
