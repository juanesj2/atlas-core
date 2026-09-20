import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const skillsDir = path.join(__dirname, '../skills');

export const atlasTools = [];
const skillExecutors = {};

// Cargador dinámico de Skills
export async function loadSkills() {
    // Limpiar arrays para recargar en caliente
    atlasTools.length = 0;
    for (let key in skillExecutors) delete skillExecutors[key];

    if (!fs.existsSync(skillsDir)) return;

    const files = fs.readdirSync(skillsDir).filter(file => file.endsWith('.js'));
    
    for (const file of files) {
        try {
            // Se añade un query timestamp para evitar el caché de V8 al recargar
            const modulePath = pathToFileURL(path.join(skillsDir, file)).href + '?t=' + Date.now();
            const skill = await import(modulePath);
            
            if (skill.definition && skill.execute) {
                atlasTools.push(skill.definition);
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

// Inicializar el loader al arrancar se hará desde index.js

export const executeLocalTool = async (action, args) => {
    if (skillExecutors[action]) {
        try {
            return await skillExecutors[action](args);
        } catch (e) {
            console.error(`[Skills] Error ejecutando ${action}:`, e.message);
            return `Ocurrió un error interno al ejecutar la herramienta ${action}.`;
        }
    }
    return null; // Laravel u otras herramientas fallback
};
