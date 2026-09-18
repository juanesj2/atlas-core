import axios from 'axios';

export const definition = {
    type: 'function',
    function: {
        name: 'search_internet',
        description: 'Busca información general en internet usando Wikipedia. Úsalo para responder preguntas culturales, históricas, ciencia, etc.',
        parameters: {
            type: 'object',
            properties: { 
                query: { type: 'string', description: 'El término exacto a buscar' } 
            },
            required: ['query']
        }
    }
};

export const execute = async (args) => {
    try {
        console.log(`[Tools] Buscando en Wikipedia: ${args.query}`);
        const url = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(args.query)}&utf8=&format=json`;
        const res = await axios.get(url);
        
        if (res.data.query.search.length > 0) {
            const title = res.data.query.search[0].title;
            const snippet = res.data.query.search[0].snippet.replace(/(<([^>]+)>)/gi, ""); // Limpiar HTML
            return `Encontré esto en internet sobre ${title}: ${snippet}. Resúmeselo al usuario de forma natural.`;
        } else {
            return `No encontré información sobre ${args.query} en internet.`;
        }
    } catch (e) {
        console.error('[Tools] Wikipedia Error:', e.message);
        return "Hubo un error de conexión al buscar en internet.";
    }
};
