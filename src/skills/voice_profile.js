export const definition = {
    type: 'function',
    function: {
        name: 'register_voice_profile',
        description: 'Usa esta función cuando el usuario te pida registrar su voz, guardar su huella de voz, memorizar su voz, calibrar su timbre o crear su perfil biométrico de voz.',
        parameters: {
            type: 'object',
            properties: {
                username: { 
                    type: 'string', 
                    description: 'Nombre del usuario a registrar (por defecto Juanes)' 
                }
            },
            required: ['username']
        }
    }
};

export const execute = async (args) => {
    const user = args.username || 'Juanes';
    return JSON.stringify({
        status: 'enrolling_triggered',
        username: user,
        message: `Iniciando proceso de calibración y registro biométrico de voz para ${user}. El calibrador se ha activado en pantalla.`
    });
};
