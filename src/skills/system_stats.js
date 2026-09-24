import { getSystemTelemetry } from '../services/systemStats.js';

export const definition = {
    type: 'function',
    function: {
        name: 'get_system_stats',
        description: 'Consulta los recursos en tiempo real del servidor de Cronos: temperaturas de CPU y tarjeta gráfica (GPU RTX 3060 Ti), uso de RAM, disco, procesador y tiempo de actividad.',
        parameters: {
            type: 'object',
            properties: {
                metric: {
                    type: 'string',
                    description: 'La métrica de interés: "all", "temperature", "cpu", "gpu", "ram", "disk", "uptime"',
                    enum: ['all', 'temperature', 'cpu', 'gpu', 'ram', 'disk', 'uptime']
                }
            },
            required: []
        }
    }
};

export const execute = async (args) => {
    try {
        const stats = await getSystemTelemetry();
        const metric = (args.metric || 'all').toLowerCase();

        const cpuTempStr = stats.cpu.temp !== null ? `${stats.cpu.temp} grados` : 'no disponible';
        const gpuTempStr = stats.gpu.available ? `${stats.gpu.temp} grados` : 'GPU en reposo';
        const gpuName = stats.gpu.name || 'RTX 3060 Ti';

        if (metric === 'temperature') {
            return `El procesador está a ${cpuTempStr} y la tarjeta gráfica ${gpuName} a ${gpuTempStr}.`;
        }
        if (metric === 'gpu') {
            if (!stats.gpu.available) return "La tarjeta gráfica NVIDIA está en reposo o apagada.";
            return `La ${gpuName} está a ${stats.gpu.temp} grados, con una carga del ${stats.gpu.gpuUsage}% y consumiendo ${stats.gpu.powerWatts} vatios. VRAM en uso: ${stats.gpu.vramUsedMb} de ${stats.gpu.vramTotalMb} megas.`;
        }
        if (metric === 'ram') {
            return `Memoria RAM al ${stats.memory.usagePercent} por ciento: ${stats.memory.usedMb} megabytes en uso de ${stats.memory.totalMb} megabytes totales.`;
        }
        if (metric === 'cpu') {
            return `Uso de CPU al ${stats.cpu.usage} por ciento a ${cpuTempStr}, modelo ${stats.cpu.model}.`;
        }

        return `Servidor operando con normalidad. Procesador al ${stats.cpu.usage}% a ${cpuTempStr}. Gráfica ${gpuName} a ${gpuTempStr} consumiendo ${stats.gpu.available ? stats.gpu.powerWatts + 'W' : '0W'}. Memoria RAM al ${stats.memory.usagePercent}%. Uptime: ${stats.uptime}.`;
    } catch (e) {
        return 'No pude obtener la telemetría del servidor en este momento.';
    }
};
