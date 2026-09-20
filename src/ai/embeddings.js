import ollama from 'ollama';

/**
 * Convierte un texto en un vector (lista de nmeros) usando Ollama.
 * Por defecto usa nomic-embed-text, que es rapidsimo y pesa poco.
 * @param {string} text 
 * @returns {Promise<number[]>} Array de floats
 */
export const getEmbedding = async (text) => {
    try {
        const response = await ollama.embeddings({
            model: 'nomic-embed-text',
            prompt: text
        });
        return response.embedding;
    } catch (e) {
        console.error('[Embeddings] Error al obtener embedding. Asegrate de haber hecho: ollama run nomic-embed-text');
        console.error(e.message);
        return null;
    }
};

/**
 * Calcula la Similitud del Coseno entre dos vectores.
 * Devuelve un valor entre -1 y 1 (1 = idnticos).
 * @param {number[]} vecA 
 * @param {number[]} vecB 
 * @returns {number}
 */
export const cosineSimilarity = (vecA, vecB) => {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};
