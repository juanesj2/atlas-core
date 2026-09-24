import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

let lastCpuMeasure = null;

/**
 * Calcula el porcentaje de uso de CPU analizando los ticks de /proc/stat
 */
function getCpuUsagePercent() {
    try {
        const stat = fs.readFileSync('/proc/stat', 'utf8');
        const firstLine = stat.split('\n')[0];
        const parts = firstLine.trim().split(/\s+/).slice(1).map(Number);
        const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;
        
        const currentIdle = idle + (iowait || 0);
        const currentTotal = user + nice + system + currentIdle + (irq || 0) + (softirq || 0) + (steal || 0);
        
        if (!lastCpuMeasure) {
            lastCpuMeasure = { idle: currentIdle, total: currentTotal };
            const load = os.loadavg()[0];
            const cores = os.cpus().length || 1;
            return Math.min(100, Math.round((load / cores) * 100 * 10) / 10);
        }
        
        const deltaIdle = currentIdle - lastCpuMeasure.idle;
        const deltaTotal = currentTotal - lastCpuMeasure.total;
        lastCpuMeasure = { idle: currentIdle, total: currentTotal };
        
        if (deltaTotal <= 0) return 0;
        const percent = ((deltaTotal - deltaIdle) / deltaTotal) * 100;
        return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
    } catch (e) {
        const load = os.loadavg()[0];
        const cores = os.cpus().length || 1;
        return Math.min(100, Math.round((load / cores) * 100 * 10) / 10);
    }
}

/**
 * Lee la temperatura de la CPU en grados Celsius desde los sensores hwmon de Linux
 */
function getCpuTemperature() {
    try {
        const hwmonPath = '/sys/class/hwmon';
        if (!fs.existsSync(hwmonPath)) return null;
        const entries = fs.readdirSync(hwmonPath);
        
        // Prioridad 1: drivers oficiales de CPU (k10temp para AMD, coretemp para Intel, zenpower)
        for (const entry of entries) {
            const dir = `${hwmonPath}/${entry}`;
            const nameFile = `${dir}/name`;
            if (fs.existsSync(nameFile)) {
                const name = fs.readFileSync(nameFile, 'utf8').trim().toLowerCase();
                if (name === 'k10temp' || name === 'coretemp' || name === 'zenpower') {
                    for (let i = 1; i <= 3; i++) {
                        const tempFile = `${dir}/temp${i}_input`;
                        if (fs.existsSync(tempFile)) {
                            const val = parseInt(fs.readFileSync(tempFile, 'utf8').trim());
                            if (!isNaN(val) && val > 0) {
                                return Math.round(val / 100) / 10;
                            }
                        }
                    }
                }
            }
        }
        
        // Prioridad 2: cualquier sensor válido en hwmon
        for (const entry of entries) {
            const tempFile = `${hwmonPath}/${entry}/temp1_input`;
            if (fs.existsSync(tempFile)) {
                const val = parseInt(fs.readFileSync(tempFile, 'utf8').trim());
                if (!isNaN(val) && val > 1000 && val < 120000) {
                    return Math.round(val / 100) / 10;
                }
            }
        }
    } catch (e) {
        console.warn('[Telemetry] Error leyendo temperatura CPU:', e.message);
    }
    return null;
}

/**
 * Obtiene métricas en tiempo real de la tarjeta gráfica NVIDIA (RTX 3060 Ti)
 */
async function getGpuStats() {
    try {
        const { stdout } = await execPromise(
            'nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw --format=csv,noheader,nounits',
            { timeout: 1500 }
        );
        const parts = stdout.trim().split(',').map(s => s.trim());
        if (parts.length >= 7) {
            const vramUsed = parseInt(parts[4]) || 0;
            const vramTotal = parseInt(parts[5]) || 1;
            const vramPercent = Math.round((vramUsed / vramTotal) * 1000) / 10;
            return {
                available: true,
                name: parts[0],
                temp: parseInt(parts[1]) || 0,
                gpuUsage: parseInt(parts[2]) || 0,
                memUsage: parseInt(parts[3]) || 0,
                vramUsedMb: vramUsed,
                vramTotalMb: vramTotal,
                vramPercent: vramPercent,
                powerWatts: Math.round((parseFloat(parts[6]) || 0) * 10) / 10
            };
        }
    } catch (e) {
        // La GPU está apagada o sin driver activo
    }
    return { available: false };
}

/**
 * Obtiene métricas reales de memoria RAM
 */
function getMemoryStats() {
    try {
        const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
        let totalKb = 0;
        let availKb = 0;
        for (const line of meminfo.split('\n')) {
            if (line.startsWith('MemTotal:')) {
                totalKb = parseInt(line.replace(/\D/g, '')) || 0;
            } else if (line.startsWith('MemAvailable:')) {
                availKb = parseInt(line.replace(/\D/g, '')) || 0;
            }
        }
        if (totalKb > 0) {
            const usedKb = totalKb - availKb;
            const totalMb = Math.round(totalKb / 1024);
            const usedMb = Math.round(usedKb / 1024);
            const freeMb = Math.round(availKb / 1024);
            const percent = Math.round((usedKb / totalKb) * 1000) / 10;
            return {
                totalMb,
                usedMb,
                freeMb,
                usagePercent: percent
            };
        }
    } catch (e) {}

    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;
    return {
        totalMb: Math.round(totalBytes / (1024 * 1024)),
        usedMb: Math.round(usedBytes / (1024 * 1024)),
        freeMb: Math.round(freeBytes / (1024 * 1024)),
        usagePercent: Math.round((usedBytes / totalBytes) * 1000) / 10
    };
}

/**
 * Obtiene métricas del disco duro principal
 */
function getDiskStats() {
    try {
        if (typeof fs.statfsSync === 'function') {
            const stats = fs.statfsSync('/');
            const total = stats.bsize * stats.blocks;
            const free = stats.bsize * stats.bfree;
            const used = total - free;
            return {
                totalGb: (total / (1024 ** 3)).toFixed(1),
                usedGb: (used / (1024 ** 3)).toFixed(1),
                freeGb: (free / (1024 ** 3)).toFixed(1),
                percent: Math.round((used / total) * 100)
            };
        }
    } catch (e) {}
    return { totalGb: "96.0", usedGb: "24.0", freeGb: "72.0", percent: 25 };
}

/**
 * Formatea el uptime en horas y minutos amigables
 */
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d} día${d > 1 ? 's' : ''}`);
    if (h > 0) parts.push(`${h} h`);
    parts.push(`${m} min`);
    return parts.join(' ');
}

/**
 * Retorna el paquete completo de telemetría del servidor
 */
export async function getSystemTelemetry() {
    const cpuUsage = getCpuUsagePercent();
    const cpuTemp = getCpuTemperature();
    const gpu = await getGpuStats();
    const memory = getMemoryStats();
    const disk = getDiskStats();
    const uptimeSec = Math.floor(os.uptime());

    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model ? cpus[0].model.replace(/\(R\)|\(TM\)/gi, '').trim() : 'AMD Ryzen';
    const cores = cpus.length;

    return {
        cpu: {
            model: cpuModel,
            cores,
            usage: cpuUsage,
            temp: cpuTemp
        },
        gpu,
        memory,
        disk,
        uptime: formatUptime(uptimeSec),
        uptimeSeconds: uptimeSec,
        network: {
            localIp: "192.168.1.161",
            tailscaleIp: "100.96.33.9",
            hostname: "cronos.local"
        },
        timestamp: new Date().toISOString()
    };
}
