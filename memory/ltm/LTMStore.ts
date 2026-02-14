import { MongoClient, Collection, Db } from 'mongodb';
import { MemoryType, AuthorityLevel, TTLPolicy, MemoryStatus } from '../types/MemoryBlock';

/**
 * Unified LTM Document
 * 
 * ONE document schema for ALL memory types.
 * The `type` field differentiates. Type-specific data lives in `metadata`.
 * Every document gets an embedding for vector search.
 */
export interface LTMDocument {
    memory_id: string;
    type: MemoryType;

    // Scoping
    tenant_id: string;
    user_id: string;
    chatbot_channel_id: string;
    originating_session_id?: string;

    // Content — the actual memory
    content: string;              // Human-readable text of what was remembered
    embedding: number[];          // Vector embedding for semantic search

    // Governance
    status: MemoryStatus;
    confidence: number;
    strength: number;
    authority_level: AuthorityLevel;
    ttl_policy: TTLPolicy;

    // Agent tracking
    owner_agent_id?: string;
    source: 'agent' | 'user_confirmed' | 'system' | 'api';

    // Type-specific metadata (flexible by design)
    // Episodic: { entities: string[], outcome?: string }
    // Semantic: { scope: 'chatbot' | 'global', tags?: string[] }
    // Procedural: { steps?: string[], success_rate?: number }
    // Persona: { trait_key?: string, trait_value?: string }
    // Consensus: { contributing_agents: string[], agreement_score: number, topic?: string }
    metadata: Record<string, any>;

    // Versioning
    version: number;
    parent_memory_id?: string;

    // Timestamps
    created_at: Date;
    updated_at: Date;
    last_accessed_at: Date;
}

/**
 * Smart defaults per memory type.
 * Applied at ingestion time when the agent doesn't override.
 */
export const MEMORY_TYPE_DEFAULTS: Record<MemoryType, {
    authority_level: AuthorityLevel;
    ttl_policy: TTLPolicy;
    initial_confidence: number;
}> = {
    [MemoryType.EPISODIC]: {
        authority_level: AuthorityLevel.STANDARD,
        ttl_policy: TTLPolicy.CHATBOT,
        initial_confidence: 0.5,
    },
    [MemoryType.SEMANTIC]: {
        authority_level: AuthorityLevel.STANDARD,
        ttl_policy: TTLPolicy.CHATBOT,
        initial_confidence: 0.5,
    },
    [MemoryType.PROCEDURAL]: {
        authority_level: AuthorityLevel.EXPERT,
        ttl_policy: TTLPolicy.CHATBOT,
        initial_confidence: 0.7,
    },
    [MemoryType.PERSONA]: {
        authority_level: AuthorityLevel.STANDARD,
        ttl_policy: TTLPolicy.PERSISTENT,
        initial_confidence: 0.6,
    },
    [MemoryType.CONSENSUS]: {
        authority_level: AuthorityLevel.SYSTEM,
        ttl_policy: TTLPolicy.CHATBOT,
        initial_confidence: 0.8,
    },
    [MemoryType.WHITEBOARD]: {
        authority_level: AuthorityLevel.STANDARD,
        ttl_policy: TTLPolicy.SESSION,
        initial_confidence: 0.3,
    },
};

/**
 * LTMStore — Unified Long-Term Memory Store
 * 
 * ONE Mongo collection. ONE vector index. ALL memory types.
 * 
 * Replaces:
 *   - SemanticLTMStore (semantic_ltm collection)
 *   - PersonaLTMStore (persona_ltm collection)
 *   - ConsensusLTMStore (consensus_ltm collection)
 *   - MongoMemoryStore's per-type collections (episodic_memory, procedural_memory, etc.)
 * 
 * Design principles:
 *   - External agents decide the memory type
 *   - One vector index covers all types (with optional type filtering)
 *   - Type-specific metadata lives in a flexible `metadata` field
 *   - Smart defaults per type (authority, TTL, confidence)
 */
export class LTMStore {
    private db: Db;
    private collectionName = 'memories';

    constructor(client: MongoClient, dbName: string) {
        this.db = client.db(dbName);
    }

    private get collection(): Collection<LTMDocument> {
        return this.db.collection<LTMDocument>(this.collectionName);
    }

    // ─────────────────────────────────────────────
    //  WRITE
    // ─────────────────────────────────────────────

    /**
     * Save a memory. Upserts by memory_id.
     * The embeddings should already be generated before calling this.
     */
    async save(doc: LTMDocument): Promise<void> {
        await this.collection.updateOne(
            { memory_id: doc.memory_id },
            { $set: doc },
            { upsert: true }
        );
    }

    /**
     * Update specific fields of an existing memory.
     */
    async update(memoryId: string, updates: Partial<LTMDocument>): Promise<void> {
        await this.collection.updateOne(
            { memory_id: memoryId },
            {
                $set: {
                    ...updates,
                    updated_at: new Date(),
                }
            }
        );
    }

    /**
     * Update the embedding for a memory (e.g., after content change or re-embedding).
     */
    async updateEmbedding(memoryId: string, embedding: number[]): Promise<void> {
        await this.collection.updateOne(
            { memory_id: memoryId },
            {
                $set: {
                    embedding,
                    updated_at: new Date(),
                }
            }
        );
    }

    /**
     * Soft-delete: mark as deprecated.
     */
    async deprecate(memoryId: string): Promise<void> {
        await this.collection.updateOne(
            { memory_id: memoryId },
            {
                $set: {
                    status: MemoryStatus.DEPRECATED,
                    updated_at: new Date(),
                }
            }
        );
    }

    /**
     * Hard delete a memory.
     */
    async delete(memoryId: string): Promise<void> {
        await this.collection.deleteOne({ memory_id: memoryId });
    }

    // ─────────────────────────────────────────────
    //  READ
    // ─────────────────────────────────────────────

    /**
     * Get a single memory by ID.
     */
    async getById(memoryId: string): Promise<LTMDocument | null> {
        const doc = await this.collection.findOne({ memory_id: memoryId });

        if (doc) {
            // Update last_accessed_at on read
            await this.collection.updateOne(
                { memory_id: memoryId },
                { $set: { last_accessed_at: new Date() } }
            );
        }

        return doc;
    }

    /**
     * Get all memories for a user within a chatbot scope.
     * Optional type filtering.
     */
    async getByScope(
        tenantId: string,
        chatbotChannelId: string,
        userId: string,
        options?: {
            types?: MemoryType[];
            statuses?: MemoryStatus[];
            limit?: number;
            minConfidence?: number;
        }
    ): Promise<LTMDocument[]> {
        const filter: any = {
            tenant_id: tenantId,
            $or: [
                { chatbot_channel_id: chatbotChannelId },
                { chatbot_channel_id: 'GLOBAL' },
            ],
            user_id: userId,
            status: { $ne: MemoryStatus.DEPRECATED },
        };

        if (options?.types && options.types.length > 0) {
            filter.type = { $in: options.types };
        }

        if (options?.statuses && options.statuses.length > 0) {
            filter.status = { $in: options.statuses };
        }

        if (options?.minConfidence !== undefined) {
            filter.confidence = { $gte: options.minConfidence };
        }

        return this.collection
            .find(filter)
            .sort({ strength: -1, created_at: -1 })
            .limit(options?.limit || 50)
            .toArray();
    }

    // ─────────────────────────────────────────────
    //  VECTOR SEARCH
    // ─────────────────────────────────────────────

    /**
     * Semantic vector search across ALL memory types (or filtered by type).
     * Uses MongoDB Atlas Vector Search ($vectorSearch aggregation stage).
     * 
     * Requires a vector search index named "memory_vector_index" on the
     * `memories` collection with path `embedding`.
     * 
     * Atlas Vector Search index definition:
     * {
     *   "type": "vectorSearch",
     *   "fields": [
     *     {
     *       "type": "vector",
     *       "path": "embedding",
     *       "numDimensions": 1536,
     *       "similarity": "cosine"
     *     },
     *     { "type": "filter", "path": "tenant_id" },
     *     { "type": "filter", "path": "chatbot_channel_id" },
     *     { "type": "filter", "path": "user_id" },
     *     { "type": "filter", "path": "type" },
     *     { "type": "filter", "path": "status" },
     *     { "type": "filter", "path": "confidence" }
     *   ]
     * }
     */
    async search(
        queryEmbedding: number[],
        tenantId: string,
        chatbotChannelId: string,
        userId: string,
        options?: {
            types?: MemoryType[];
            limit?: number;
            minConfidence?: number;
            includeGlobal?: boolean;
        }
    ): Promise<(LTMDocument & { score: number })[]> {
        const limit = options?.limit || 10;
        const minConfidence = options?.minConfidence || 0.0;

        // Build pre-filter for vector search
        const filter: any = {
            tenant_id: tenantId,
            status: { $ne: MemoryStatus.DEPRECATED },
        };

        if (minConfidence > 0) {
            filter.confidence = { $gte: minConfidence };
        }

        if (options?.types && options.types.length > 0) {
            filter.type = { $in: options.types };
        }

        // Scope: user's chatbot channel, optionally include GLOBAL
        if (options?.includeGlobal) {
            filter.$or = [
                { chatbot_channel_id: chatbotChannelId, user_id: userId },
                { chatbot_channel_id: 'GLOBAL' },
            ];
        } else {
            filter.chatbot_channel_id = chatbotChannelId;
            filter.user_id = userId;
        }

        const pipeline = [
            {
                $vectorSearch: {
                    index: 'memory_vector_index',
                    path: 'embedding',
                    queryVector: queryEmbedding,
                    numCandidates: Math.max(limit * 10, 100),
                    limit: limit,
                    filter: filter,
                }
            },
            {
                $addFields: {
                    score: { $meta: 'vectorSearchScore' }
                }
            },
            {
                $project: {
                    _id: 0,
                    embedding: 0, // Don't return the full 1536-dim vector
                }
            }
        ];

        const results = await this.collection
            .aggregate<LTMDocument & { score: number }>(pipeline)
            .toArray();

        // Update last_accessed_at for retrieved memories
        if (results.length > 0) {
            const ids = results.map(r => r.memory_id);
            await this.collection.updateMany(
                { memory_id: { $in: ids } },
                { $set: { last_accessed_at: new Date() } }
            );
        }

        return results;
    }

    // ─────────────────────────────────────────────
    //  MAINTENANCE
    // ─────────────────────────────────────────────

    /**
     * Find memories that might conflict with new content.
     * Used by ConflictDetector during ingestion.
     */
    async findSimilar(
        embedding: number[],
        tenantId: string,
        chatbotChannelId: string,
        userId: string,
        type: MemoryType,
        limit: number = 5
    ): Promise<(LTMDocument & { score: number })[]> {
        return this.search(embedding, tenantId, chatbotChannelId, userId, {
            types: [type],
            limit,
            includeGlobal: false,
        });
    }

    /**
     * Update strength for decay purposes.
     */
    async updateStrength(memoryId: string, newStrength: number): Promise<void> {
        await this.collection.updateOne(
            { memory_id: memoryId },
            {
                $set: {
                    strength: Math.max(0, Math.min(1, newStrength)),
                    updated_at: new Date(),
                }
            }
        );
    }

    /**
     * Update confidence score.
     */
    async updateConfidence(memoryId: string, newConfidence: number): Promise<void> {
        await this.collection.updateOne(
            { memory_id: memoryId },
            {
                $set: {
                    confidence: Math.max(0, Math.min(1, newConfidence)),
                    updated_at: new Date(),
                }
            }
        );
    }

    /**
     * Get memories that are weak (for decay/cleanup).
     */
    async getWeakMemories(
        tenantId: string,
        chatbotChannelId: string,
        maxStrength: number = 0.1
    ): Promise<LTMDocument[]> {
        return this.collection
            .find({
                tenant_id: tenantId,
                chatbot_channel_id: chatbotChannelId,
                strength: { $lte: maxStrength },
                status: { $ne: MemoryStatus.DEPRECATED },
            })
            .toArray();
    }

    /**
     * Ensure required indexes exist.
     * Call this once on startup.
     * Note: The vector search index must be created through Atlas UI or CLI.
     */
    async ensureIndexes(): Promise<void> {
        // Standard indexes for common query patterns
        await this.collection.createIndex({ memory_id: 1 }, { unique: true });
        await this.collection.createIndex({ tenant_id: 1, chatbot_channel_id: 1, user_id: 1 });
        await this.collection.createIndex({ tenant_id: 1, chatbot_channel_id: 1, type: 1 });
        await this.collection.createIndex({ status: 1 });
        await this.collection.createIndex({ strength: 1 });
        await this.collection.createIndex({ created_at: -1 });

        console.log('[LTMStore] Standard indexes ensured (vector index must be created in Atlas)');
    }
}
