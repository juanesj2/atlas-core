import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { exec } from 'child_process';
import util from 'util';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const execPromise = util.promisify(exec);

// ==========================================
// CONFIGURACIÓN DE GOOGLE WORKSPACE (OAUTH 2.0)
// ==========================================
export const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
);

// Si existe el token, se lo inyectamos al cliente
if (process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Asumiendo que projectRoot es ATLAS/ (dos niveles arriba si estamos en src/ai)
const projectRoot = path.resolve(__dirname, '../../'); 

const skillsDir = path.join(__dirname, '../skills');

export const CronosTools = [];
const skillExecutors = {};

// ==========================================
// UTILIDADES DE SEGURIDAD
// ==========================================
function validarRutaSegura(rutaSolicitada) {
    // Resolvemos la ruta a absoluta
    const rutaAbsoluta = path.resolve(projectRoot, rutaSolicitada);
    // Verificamos que la ruta final comience estrictamente con la raíz del proyecto
    if (!rutaAbsoluta.startsWith(projectRoot)) {
        throw new Error("Acceso denegado: Intento de Path Traversal detectado.");
    }
    return rutaAbsoluta;
}

// ==========================================
// HERRAMIENTAS NATIVAS DE AUTOPROGRAMACIÓN
// ==========================================
const nativeToolsDefinitions = [
    {
        type: "function",
        function: {
            name: "leer_codigo",
            description: "Lee el contenido de un archivo en el proyecto. Usa rutas relativas al proyecto, por ejemplo 'src/index.js'.",
            parameters: {
                type: "object",
                properties: {
                    ruta: { type: "string", description: "Ruta relativa del archivo a leer (ej. 'src/ai/tools.js')" }
                },
                required: ["ruta"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "escribir_codigo",
            description: "Sobrescribe o crea un archivo en el proyecto con nuevo contenido. Debes enviar el código completo.",
            parameters: {
                type: "object",
                properties: {
                    ruta: { type: "string", description: "Ruta relativa del archivo a escribir" },
                    contenido: { type: "string", description: "El código fuente completo a guardar" }
                },
                required: ["ruta", "contenido"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "crear_pr_github",
            description: "Sube los cambios locales a una nueva rama en GitHub para revisión humana (Agentic Workflow).",
            parameters: {
                type: "object",
                properties: {
                    nombre_rama: { type: "string", description: "Nombre de la rama (letras, números y guiones)" },
                    mensaje_commit: { type: "string", description: "Mensaje descriptivo del cambio" }
                },
                required: ["nombre_rama", "mensaje_commit"]
            }
        }
    },
    // --- GOOGLE WORKSPACE TOOLS ---
    {
        type: "function",
        function: {
            name: "leer_gmail",
            description: "Lee los últimos 5 correos no leídos de la cuenta de Gmail del usuario.",
            parameters: { type: "object", properties: {}, required: [] }
        }
    },
    {
        type: "function",
        function: {
            name: "listar_calendario",
            description: "Lista los eventos programados para el día de hoy en Google Calendar.",
            parameters: { type: "object", properties: {}, required: [] }
        }
    },
    {
        type: "function",
        function: {
            name: "crear_drive",
            description: "Crea un archivo de texto básico en la raíz de Google Drive.",
            parameters: {
                type: "object",
                properties: {
                    nombre_archivo: { type: "string", description: "Nombre del archivo (ej. recordatorio.txt)" },
                    contenido: { type: "string", description: "Contenido de texto del archivo" }
                },
                required: ["nombre_archivo", "contenido"]
            }
        }
    }
];

const nativeExecutors = {
    leer_codigo: async ({ ruta }) => {
        try {
            const rutaSegura = validarRutaSegura(ruta);
            if (!fs.existsSync(rutaSegura)) return `El archivo ${ruta} no existe.`;
            const contenido = fs.readFileSync(rutaSegura, 'utf-8');
            return `--- Inicio de ${ruta} ---\n${contenido}\n--- Fin de ${ruta} ---`;
        } catch (e) {
            return `Error al leer código: ${e.message}`;
        }
    },
    escribir_codigo: async ({ ruta, contenido }) => {
        try {
            const rutaSegura = validarRutaSegura(ruta);
            const dir = path.dirname(rutaSegura);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(rutaSegura, contenido, 'utf-8');
            return `Éxito: Archivo ${ruta} guardado correctamente.`;
        } catch (e) {
            return `Error al escribir código: ${e.message}`;
        }
    },
    crear_pr_github: async ({ nombre_rama, mensaje_commit }) => {
        try {
            // Sanitización estricta para evitar inyección de comandos
            const safeBranch = nombre_rama.replace(/[^a-zA-Z0-9_-]/g, '');
            const safeCommit = mensaje_commit.replace(/"/g, '\\"'); // Escapar comillas
            
            if (!safeBranch) throw new Error("Nombre de rama inválido.");

            const options = { cwd: projectRoot };
            
            // Secuencia de Git
            await execPromise(`git checkout -b ${safeBranch}`, options);
            await execPromise(`git add .`, options);
            await execPromise(`git commit -m "${safeCommit}"`, options);
            await execPromise(`git push origin ${safeBranch}`, options);
            
            // Volver a main para no dejar el servidor local inestable
            await execPromise(`git checkout main`, options);
            
            return `Cambios subidos a GitHub en la rama '${safeBranch}'. Queda a la espera de revisión (PR).`;
        } catch (e) {
            // Intentar volver a main en caso de error
            try { await execPromise('git checkout main', { cwd: projectRoot }); } catch (_) {}
            return `Error subiendo a GitHub: ${e.message}`;
        }
    },
    // --- GOOGLE WORKSPACE EXECUTORS ---
    leer_gmail: async () => {
        try {
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread', maxResults: 5 });
            const messages = res.data.messages;
            if (!messages || messages.length === 0) return "No tienes correos nuevos sin leer.";
            
            let result = "Tus últimos correos no leídos son:\n";
            for (const m of messages) {
                const msg = await gmail.users.messages.get({ userId: 'me', id: m.id });
                const headers = msg.data.payload.headers;
                const subject = headers.find(h => h.name === 'Subject')?.value || 'Sin asunto';
                const from = headers.find(h => h.name === 'From')?.value || 'Desconocido';
                result += `- De: ${from} | Asunto: ${subject}\n`;
            }
            return result;
        } catch (e) { return `Error accediendo a Gmail: ${e.message}`; }
    },
    listar_calendario: async () => {
        try {
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            const res = await calendar.events.list({
                calendarId: 'primary',
                timeMin: today.toISOString(),
                timeMax: tomorrow.toISOString(),
                singleEvents: true,
                orderBy: 'startTime'
            });
            const events = res.data.items;
            if (!events || events.length === 0) return "No tienes eventos programados para hoy en Calendar.";
            
            let result = "Eventos para hoy:\n";
            events.forEach((event, i) => {
                const start = event.start.dateTime || event.start.date;
                result += `${i+1}. ${event.summary} (Inicio: ${start})\n`;
            });
            return result;
        } catch(e) { return `Error accediendo a Calendar: ${e.message}`; }
    },
    crear_drive: async ({ nombre_archivo, contenido }) => {
        try {
            const drive = google.drive({ version: 'v3', auth: oauth2Client });
            const res = await drive.files.create({
                requestBody: { name: nombre_archivo, mimeType: 'text/plain' },
                media: { mimeType: 'text/plain', body: contenido }
            });
            return `¡Éxito! Archivo de texto "${nombre_archivo}" creado en Google Drive.`;
        } catch (e) { return `Error creando archivo en Drive: ${e.message}`; }
    }
};

// ==========================================
// GESTIÓN DE SKILLS
// ==========================================

export async function loadSkills() {
    // Limpiar arrays para recargar en caliente
    CronosTools.length = 0;
    for (let key in skillExecutors) delete skillExecutors[key];

    // 1. Cargar herramientas nativas (Agentic Workflows)
    nativeToolsDefinitions.forEach(def => CronosTools.push(def));
    Object.assign(skillExecutors, nativeExecutors);

    // 2. Cargar Skills dinámicas
    if (!fs.existsSync(skillsDir)) return;

    const files = fs.readdirSync(skillsDir).filter(file => file.endsWith('.js'));
    
    for (const file of files) {
        try {
            const modulePath = pathToFileURL(path.join(skillsDir, file)).href + '?t=' + Date.now();
            const skill = await import(modulePath);
            
            if (skill.definition && skill.execute) {
                CronosTools.push(skill.definition);
                skillExecutors[skill.definition.function.name] = skill.execute;
                console.log(`[Skills] Cargada: ${skill.definition.function.name}`);
            } else {
                console.warn(`[Skills] El archivo ${file} no exporta 'definition' o 'execute'.`);
            }
        } catch (e) {
            console.error(`[Skills] Error cargando la skill ${file}:`, e.message);
        }
    }
}

export const executeLocalTool = async (action, args) => {
    if (skillExecutors[action]) {
        try {
            return await skillExecutors[action](args);
        } catch (e) {
            console.error(`[Skills] Error ejecutando ${action}:`, e.message);
            return `Ocurrió un error interno al ejecutar la herramienta ${action}.`;
        }
    }
    return null;
};
