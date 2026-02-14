import OpenAI from 'openai';

/**
 * EmbeddingService
 * 
 * Generates real vector embeddings using OpenAI's text-embedding-3-small model.
 * This replaces ALL mock `new Array(1536).fill(0.1)` calls across the system.
 * 
 * Single source of truth for embedding generation — every component
 * that needs embeddings gets them from here.
 */
export class EmbeddingService {
    private client: OpenAI;
    private model: string;
    private dimensions: number;

    constructor(apiKey?: string, model: string = 'text-embedding-3-small', dimensions: number = 1536) {
        const key = apiKey || process.env.OPENAI_API_KEY;
        if (!key) {
            throw new Error('OPENAI_API_KEY is required for EmbeddingService. Set it in environment or pass directly.');
        }

        this.client = new OpenAI({ apiKey: key });
        this.model = model;
        this.dimensions = dimensions;
    }

    /**
     * Generate embedding for a single text input.
     * Used for both memory storage and query-time search.
     */
    async generateEmbedding(text: string): Promise<number[]> {
        if (!text || text.trim().length === 0) {
            throw new Error('Cannot generate embedding for empty text');
        }

        // Truncate extremely long text (OpenAI has ~8191 token limit for this model)
        const truncated = text.length > 20000 ? text.substring(0, 20000) : text;

        try {
            const response = await this.client.embeddings.create({
                model: this.model,
                input: truncated,
                dimensions: this.dimensions,
            });

            return response.data[0].embedding;
        } catch (error: any) {
            // Retry once on transient errors
            if (error?.status === 429 || error?.status === 500 || error?.status === 503) {
                console.warn(`[EmbeddingService] Transient error (${error.status}), retrying in 1s...`);
                await this.sleep(1000);

                const retryResponse = await this.client.embeddings.create({
                    model: this.model,
                    input: truncated,
                    dimensions: this.dimensions,
                });

                return retryResponse.data[0].embedding;
            }

            console.error('[EmbeddingService] Failed to generate embedding:', error?.message || error);
            throw new Error(`Embedding generation failed: ${error?.message || 'Unknown error'}`);
        }
    }

    /**
     * Generate embeddings for multiple texts in a single API call.
     * More efficient than calling generateEmbedding() in a loop.
     * OpenAI supports up to 2048 inputs per batch.
     */
    async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        // Filter and truncate
        const inputs = texts.map(t => {
            if (!t || t.trim().length === 0) return '[empty]';
            return t.length > 20000 ? t.substring(0, 20000) : t;
        });

        try {
            const response = await this.client.embeddings.create({
                model: this.model,
                input: inputs,
                dimensions: this.dimensions,
            });

            // Sort by index to ensure order matches input
            const sorted = response.data.sort((a, b) => a.index - b.index);
            return sorted.map(d => d.embedding);
        } catch (error: any) {
            console.error('[EmbeddingService] Batch embedding failed:', error?.message || error);
            throw new Error(`Batch embedding generation failed: ${error?.message || 'Unknown error'}`);
        }
    }

    /**
     * Get the dimensionality of embeddings produced by this service.
     * Useful for index configuration.
     */
    getDimensions(): number {
        return this.dimensions;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
