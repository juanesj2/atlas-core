import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_FILE = path.join(__dirname, '../../memory.json');

/**
 * Inicializa el archivo de memoria si no existe.
 */
const initMemory = () => {
    if (!fs.existsSync(MEMORY_FILE)) {
        const defaultMemory = {
            global: ["Eres ATLAS, el asistente del hogar inteligente.", "La casa está ubicada en Madrid."],
            users: {
                juanes: ["Creador y administrador principal del sistema."]
            }
        };
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(defaultMemory, null, 2), 'utf-8');
    }
};

/**
 * Lee la memoria completa del archivo.
 */
const readMemoryFile = () => {
    initMemory();
    try {
        const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.error("[MemoryManager] Error leyendo memoria:", e);
        return { global: [], users: {} };
    }
};

/**
 * Guarda el objeto de memoria en el archivo.
 */
const writeMemoryFile = (memoryObj) => {
    try {
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryObj, null, 2), 'utf-8');
    } catch (e) {
        console.error("[MemoryManager] Error escribiendo memoria:", e);
    }
};

/**
 * Obtiene los recuerdos globales y los específicos de un usuario.
 * @param {string} username - Nombre del usuario (puede ser 'invitado' o vacío)
 * @returns {string} - Texto formateado para inyectar en el System Prompt
 */
export const getMemoryStringForUser = (username) => {
    const mem = readMemoryFile();
    let text = "MEMORIA A LARGO PLAZO DISPONIBLE:\n";
    
    if (mem.global && mem.global.length > 0) {
        text += "- Datos generales de la casa: " + mem.global.join(" ") + "\n";
    }

    const cleanUser = username ? username.toLowerCase().trim() : 'invitado';

    if (cleanUser !== 'invitado' && mem.users && mem.users[cleanUser]) {
        text += `- Datos sobre el usuario actual (${cleanUser}): ` + mem.users[cleanUser].join(" ") + "\n";
    } else if (cleanUser === 'invitado') {
        text += "- Datos sobre el usuario actual: NINGUNO. Es un invitado no registrado.\n";
    }

    return text;
};

/**
 * Guarda un nuevo hecho para un usuario específico.
 * @param {string} username - Nombre del usuario
 * @param {string} fact - Hecho a recordar
 * @returns {boolean} - True si se guardó con éxito
 */
export const saveFact = (username, fact) => {
    if (!username || username.trim() === '' || username.toLowerCase() === 'invitado') {
        console.log(`[MemoryManager] Intento de guardar para usuario inválido: ${username}`);
        return false;
    }

    const cleanUser = username.toLowerCase().trim();
    const mem = readMemoryFile();

    if (!mem.users) mem.users = {};
    if (!mem.users[cleanUser]) mem.users[cleanUser] = [];

    // Evitar duplicados
    if (!mem.users[cleanUser].includes(fact)) {
        mem.users[cleanUser].push(fact);
        writeMemoryFile(mem);
        console.log(`[MemoryManager] 🧠 Dato recordado para ${cleanUser}: "${fact}"`);
        return true;
    }
    
    return false;
};
