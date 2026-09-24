import axios from 'axios';

export const definition = {
    type: 'function',
    function: {
        name: 'search_internet',
        description: 'Busca en internet en tiempo real noticias actuales, información de última hora, sucesos, tecnología, deportes, clima exterior o cualquier dato de la red. OBLIGATORIO usar esta herramienta siempre que pregunten por noticias, qué pasa en el mundo o información actualizada.',
        parameters: {
            type: 'object',
            properties: { 
                query: { type: 'string', description: 'La consulta o término de búsqueda en internet' } 
            },
            required: ['query']
        }
    }
};

export const execute = async (args) => {
    const query = args.query;
    try {
        console.log(`[WebSearch] 🌐 Explorando internet para: "${query}"...`);
        
        // 1. Si la búsqueda es de noticias o actualidad, consultar Google News RSS
        const isNewsQuery = /\b(noticia|noticias|actualidad|albacete|suceso|sucesos|ultima hora|hoy|periodico)\b/i.test(query);
        if (isNewsQuery) {
            try {
                const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es&gl=ES&ceid=ES:es`;
                const rssRes = await axios.get(rssUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                    timeout: 4500
                });
                const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>/g;
                let newsItems = [];
                let match;
                while ((match = itemRegex.exec(rssRes.data)) !== null && newsItems.length < 4) {
                    const title = match[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/&quot;/g, '"').trim();
                    newsItems.push(title);
                }
                if (newsItems.length > 0) {
                    return `Titulares y noticias de última hora sobre "${query}":\n` +
                        newsItems.map((n, i) => `${i + 1}. ${n}`).join('\n') +
                        '\nResume los 1 o 2 titulares más destacados de forma directa, breve y natural.';
                }
            } catch (errRss) {
                console.warn('[WebSearch] Error en Google News RSS, pasando a DuckDuckGo:', errRss.message);
            }
        }

        // 2. DuckDuckGo HTML en tiempo real
        const res = await axios.post('https://html.duckduckgo.com/html/', `q=${encodeURIComponent(query)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 6000
        });

        const snippetRegex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g;
        let matches = [];
        let match;
        while ((match = snippetRegex.exec(res.data)) !== null && matches.length < 4) {
            const clean = match[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'")
                .replace(/&amp;/g, '&')
                .replace(/\s+/g, ' ')
                .trim();
            if (clean && clean.length > 20) {
                matches.push(clean);
            }
        }

        if (matches.length > 0) {
            return `Resultados actuales encontrados en la red sobre "${query}":\n` + 
                matches.map((m, i) => `${i + 1}. ${m}`).join('\n') + 
                '\nSintetiza lo más interesante de forma natural y directa.';
        }

        // 3. Fallback a Wikipedia si no hubo snippets en DDG
        const wikiUrl = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`;
        const wikiRes = await axios.get(wikiUrl, { timeout: 4000 });
        if (wikiRes.data?.query?.search?.length > 0) {
            const top = wikiRes.data.query.search[0];
            const cleanSnippet = top.snippet.replace(/<[^>]+>/g, '');
            return `Información de internet sobre ${top.title}: ${cleanSnippet}`;
        }

        return `No encontré resultados específicos en internet sobre "${query}".`;
    } catch (e) {
        console.error('[WebSearch] Error en búsqueda:', e.message);
        return `Hubo un inconveniente al conectar con la red para buscar "${query}".`;
    }
};
