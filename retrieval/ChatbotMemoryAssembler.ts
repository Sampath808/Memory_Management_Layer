
import { STMStore } from '../memory/stm/STMStore';
import { SqlMemoryIndex } from '../memory/store/SqlMemoryIndex';
import { LTMStore, LTMDocument } from '../memory/ltm/LTMStore';
import { EmbeddingService } from '../memory/ltm/EmbeddingService';
import { MemoryType, MemoryStatus } from '../memory/types/MemoryBlock';

export interface ChatbotRetrievalContext {
    userChannelSessionId: string;
    chatbotChannelId: string;

    tenantId: string;
    userId: string;

    agentRole: string;
    workflowStep: string;
    tokenBudget: number;

    queryText?: string;
    types?: MemoryType[];     // Optional: filter by memory types
}

/**
 * Chatbot Memory Assembler
 * 
 * Assembles context for AI agents by pulling from multiple memory sources:
 *   1. STM (Short-Term Memory) — current session state from Redis
 *   2. LTM Vector Search — semantically relevant memories via embeddings
 *   3. LTM Scope Fetch — recent memories within the chatbot scope (SQL fallback)
 * 
 * Produces a token-budgeted, prompt-ready string that agents
 * can inject into their system prompt or context window.
 */
export class ChatbotMemoryAssembler {
    private stmStore: STMStore;
    private ltmStore: LTMStore;
    private ltmIndex: SqlMemoryIndex;
    private embeddingService: EmbeddingService;

    constructor(
        stmStore: STMStore,
        ltmStore: LTMStore,
        ltmIndex: SqlMemoryIndex,
        embeddingService: EmbeddingService,
    ) {
        this.stmStore = stmStore;
        this.ltmStore = ltmStore;
        this.ltmIndex = ltmIndex;
        this.embeddingService = embeddingService;
    }

    async assembleContext(context: ChatbotRetrievalContext): Promise<string> {
        let estimatedTokens = 0;
        const segments: string[] = [];

        // ─────────────────────────────────────
        // 1. STM — Highest Priority
        // ─────────────────────────────────────
        try {
            const stmState = await this.stmStore.loadSTM(context.userChannelSessionId);
            if (stmState) {
                const stmText = [
                    '[CURRENT SESSION STATE]',
                    stmState.active_intent ? `Intent: ${stmState.active_intent}` : null,
                    stmState.focus_entity_ids.length > 0 ? `Focus: ${stmState.focus_entity_ids.join(', ')}` : null,
                    stmState.pending_actions.length > 0 ? `Pending: ${stmState.pending_actions.join(', ')}` : null,
                    `State: ${stmState.summarized_state}`,
                ].filter(Boolean).join('\n');

                segments.push(stmText);
                estimatedTokens += this.estimateTokens(stmText);
            }
        } catch (error) {
            console.warn('[Assembler] STM fetch failed, continuing without:', error);
        }

        // ─────────────────────────────────────
        // 2. LTM Vector Search — Semantic Recall
        // ─────────────────────────────────────
        if (context.queryText && context.queryText.trim().length > 0) {
            try {
                // Truncate overly long queries
                const query = context.queryText.length > 500
                    ? context.queryText.substring(0, 500)
                    : context.queryText;

                const queryEmbedding = await this.embeddingService.generateEmbedding(query);

                const searchResults = await this.ltmStore.search(
                    queryEmbedding,
                    context.tenantId,
                    context.chatbotChannelId,
                    context.userId,
                    {
                        types: context.types,
                        limit: 10,
                        minConfidence: 0.3, // Include even lower-confidence memories
                        includeGlobal: true,
                    }
                );

                if (searchResults.length > 0) {
                    const memoryLines: string[] = ['[RELEVANT MEMORIES]'];

                    for (const mem of searchResults) {
                        if (estimatedTokens >= context.tokenBudget) break;

                        const typeLabel = mem.type.toUpperCase();
                        const confidence = (mem.confidence * 100).toFixed(0);
                        const relevance = (mem.score * 100).toFixed(0);
                        const line = `[${typeLabel}] (relevance: ${relevance}%, confidence: ${confidence}%) ${mem.content}`;

                        const lineTokens = this.estimateTokens(line);
                        if (estimatedTokens + lineTokens > context.tokenBudget) break;

                        memoryLines.push(line);
                        estimatedTokens += lineTokens;
                    }

                    if (memoryLines.length > 1) {
                        segments.push(memoryLines.join('\n'));
                    }
                }
            } catch (error) {
                console.warn('[Assembler] Vector search failed, falling back to scope fetch:', error);
                // Fall through to scope-based retrieval
            }
        }

        // ─────────────────────────────────────
        // 3. LTM Scope Fetch — Recent Memories (fallback / supplement)
        // ─────────────────────────────────────
        if (estimatedTokens < context.tokenBudget * 0.8) {
            try {
                const scopeMemories = await this.ltmStore.getByScope(
                    context.tenantId,
                    context.chatbotChannelId,
                    context.userId,
                    {
                        types: [MemoryType.PERSONA, MemoryType.PROCEDURAL],
                        statuses: [MemoryStatus.VALIDATED, MemoryStatus.CONSENSUS],
                        limit: 5,
                        minConfidence: 0.4,
                    }
                );

                if (scopeMemories.length > 0) {
                    const backgroundLines: string[] = ['[BACKGROUND KNOWLEDGE]'];

                    for (const mem of scopeMemories) {
                        if (estimatedTokens >= context.tokenBudget) break;

                        const line = `[${mem.type.toUpperCase()}] ${mem.content}`;
                        const lineTokens = this.estimateTokens(line);

                        if (estimatedTokens + lineTokens > context.tokenBudget) break;

                        backgroundLines.push(line);
                        estimatedTokens += lineTokens;
                    }

                    if (backgroundLines.length > 1) {
                        segments.push(backgroundLines.join('\n'));
                    }
                }
            } catch (error) {
                console.warn('[Assembler] Scope fetch failed:', error);
            }
        }

        if (segments.length === 0) {
            return '[No memories available for this context]';
        }

        return segments.join('\n\n');
    }

    /**
     * Rough token estimation.
     * ~4 characters per token is a reasonable approximation for English text.
     * In production, use tiktoken for exact counts.
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }
}
