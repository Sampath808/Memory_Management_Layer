
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { MemoryBlock, MemoryStatus, MemoryType, TTLPolicy } from '../types/MemoryBlock';
import { SqlMemoryIndex } from '../store/SqlMemoryIndex';
import { LTMStore, LTMDocument, MEMORY_TYPE_DEFAULTS } from '../ltm/LTMStore';
import { EmbeddingService } from '../ltm/EmbeddingService';

/**
 * What an external agent sends to store a memory.
 * 
 * The agent decides:
 *   - type: what kind of memory (episodic, semantic, etc.)
 *   - content: the text to remember
 *   - metadata: type-specific extra data
 * 
 * The memory layer handles:
 *   - embedding generation
 *   - smart defaults (authority, TTL, confidence)
 *   - governance (status lifecycle)
 *   - scoping enforcement
 */
export interface ProposedMemory {
    // Required: what to remember
    type: MemoryType;
    content: string;                  // The actual memory text — gets embedded

    // Required: who owns this memory
    tenant_id: string;
    user_id: string;
    chatbot_channel_id: string;

    // Optional: extra context
    originating_session_id?: string;
    metadata?: Record<string, any>;   // Type-specific metadata (entities, tags, steps, etc.)
    ttl_policy?: TTLPolicy;           // Override default TTL for this type
    source?: 'agent' | 'user_confirmed' | 'system' | 'api';
}

/**
 * Memory Intake Service
 * 
 * The single entry point for ALL memory creation.
 * External agents call this to store memories.
 * 
 * Responsibilities:
 *   1. Validate the proposal
 *   2. Generate real vector embedding
 *   3. Apply type-based smart defaults
 *   4. Write to unified LTMStore (Mongo — content + embedding)
 *   5. Write to SqlMemoryIndex (PG — governance metadata)
 *   6. Emit event for MemoryManagerAgent to pick up
 */
export class IntakeService extends EventEmitter {
    private sqlIndex: SqlMemoryIndex;
    private ltmStore: LTMStore;
    private embeddingService: EmbeddingService;

    constructor(sqlIndex: SqlMemoryIndex, ltmStore: LTMStore, embeddingService: EmbeddingService) {
        super();
        this.sqlIndex = sqlIndex;
        this.ltmStore = ltmStore;
        this.embeddingService = embeddingService;
    }

    /**
     * Ingest a new memory from an external agent.
     * 
     * Flow:
     *   Agent sends ProposedMemory
     *     → validate
     *     → generate embedding
     *     → apply type defaults
     *     → write LTMStore (Mongo)
     *     → write SqlMemoryIndex (PG)
     *     → emit event
     *     → return memory_id
     */
    async ingestMemory(proposal: ProposedMemory, agentId: string): Promise<string> {
        // ── 1. Validate ──
        if (!proposal.content || proposal.content.trim().length === 0) {
            throw new Error('Invalid memory proposal: content cannot be empty');
        }
        if (!proposal.type) {
            throw new Error('Invalid memory proposal: type is required');
        }
        if (!proposal.tenant_id || !proposal.user_id || !proposal.chatbot_channel_id) {
            throw new Error('Invalid memory proposal: Missing mandatory scoping fields (tenant_id, user_id, chatbot_channel_id)');
        }

        const memoryId = randomUUID();
        const now = new Date();

        // ── 2. Generate real embedding ──
        let embedding: number[];
        try {
            embedding = await this.embeddingService.generateEmbedding(proposal.content);
        } catch (error: any) {
            console.error(`[IntakeService] Embedding generation failed for memory ${memoryId}:`, error.message);
            throw new Error(`Memory ingestion failed: Could not generate embedding — ${error.message}`);
        }

        // ── 3. Apply type-based smart defaults ──
        const defaults = MEMORY_TYPE_DEFAULTS[proposal.type];

        // Handle semantic memories with global scope
        const effectiveChannelId = (
            proposal.type === MemoryType.SEMANTIC &&
            proposal.metadata?.scope === 'global'
        ) ? 'GLOBAL' : proposal.chatbot_channel_id;

        const effectiveTTL = (
            proposal.type === MemoryType.SEMANTIC &&
            proposal.metadata?.scope === 'global'
        ) ? TTLPolicy.PERSISTENT : (proposal.ttl_policy || defaults.ttl_policy);

        // ── 4. Build LTM document (Mongo) ──
        const ltmDoc: LTMDocument = {
            memory_id: memoryId,
            type: proposal.type,

            tenant_id: proposal.tenant_id,
            user_id: proposal.user_id,
            chatbot_channel_id: effectiveChannelId,
            originating_session_id: proposal.originating_session_id,

            content: proposal.content,
            embedding: embedding,

            status: MemoryStatus.DRAFT,
            confidence: defaults.initial_confidence,
            strength: 1.0,
            authority_level: defaults.authority_level,
            ttl_policy: effectiveTTL,

            owner_agent_id: agentId,
            source: proposal.source || 'agent',

            metadata: proposal.metadata || {},

            version: 1,

            created_at: now,
            updated_at: now,
            last_accessed_at: now,
        };

        // ── 5. Build PG index row ──
        const memoryBlock: MemoryBlock = {
            memory_id: memoryId,
            type: proposal.type,
            status: MemoryStatus.DRAFT,

            tenant_id: proposal.tenant_id,
            user_id: proposal.user_id,
            chatbot_channel_id: effectiveChannelId,
            originating_session_id: proposal.originating_session_id,

            owner_agent_id: agentId,
            authority_level: defaults.authority_level,

            confidence: defaults.initial_confidence,
            strength: 1.0,

            version: 1,

            content_type: 'mongo',
            content_ref: memoryId,

            summary: proposal.content.substring(0, 200),
            ttl_policy: effectiveTTL,

            created_at: now,
            updated_at: now,
            last_accessed_at: now,
        };

        // ── 6. Write to both stores ──
        try {
            // Write content + embedding to Mongo
            await this.ltmStore.save(ltmDoc);

            // Write metadata to PG
            await this.sqlIndex.createMemoryBlock(memoryBlock);

            // ── 7. Emit event for downstream processing ──
            this.emit('memory_ingested', {
                memoryId,
                type: proposal.type,
                agentId,
                chatbotChannelId: effectiveChannelId,
                userId: proposal.user_id,
                tenantId: proposal.tenant_id,
                confidence: defaults.initial_confidence,
                timestamp: now,
            });

            console.log(`[IntakeService] Memory ingested: ${memoryId} [${proposal.type}] conf=${defaults.initial_confidence}`);
            return memoryId;

        } catch (error: any) {
            console.error(`[IntakeService] Failed to ingest memory ${memoryId}:`, error.message);
            throw error;
        }
    }
}
