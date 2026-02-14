
import { Pool } from 'pg';
import { MemoryBlock, MemoryStatus, MemoryType } from '../types/MemoryBlock';

/**
 * SQL Memory Index Service
 * Authoritative source for memory metadata.
 * UPDATED FOR CHATBOT-CENTRIC MODEL
 * - Removed channel_domain_id
 * - chatbot_channel_id is the primary partition
 */
export class SqlMemoryIndex {
    private pool: Pool;

    constructor(dependency: string | Pool) {
        if (typeof dependency === 'string') {
            this.pool = new Pool({ connectionString: dependency });
        } else {
            this.pool = dependency;
        }
    }

    /**
     * Insert a new memory block.
     */
    async createMemoryBlock(memory: MemoryBlock): Promise<string> {
        const query = `
      INSERT INTO memory_block (
        memory_id, type, status,
        tenant_id, user_id, 
        chatbot_channel_id, 
        originating_session_id,
        owner_agent_id, authority_level,
        confidence, strength,
        version, parent_memory_id,
        content_type, content_ref,
        summary, ttl_policy,
        created_at, updated_at, last_accessed_at
      ) VALUES (
        $1, $2, $3,
        $4, $5,
        $6, 
        $7,
        $8, $9,
        $10, $11,
        $12, $13,
        $14, $15,
        $16, $17,
        $18, $19, $20
      )
      RETURNING memory_id;
    `;

        const values = [
            memory.memory_id, memory.type, memory.status,
            memory.tenant_id, memory.user_id,
            memory.chatbot_channel_id,
            memory.originating_session_id || null,
            memory.owner_agent_id || null,
            memory.authority_level,
            memory.confidence, memory.strength,
            memory.version, memory.parent_memory_id || null,
            memory.content_type, memory.content_ref || null,
            memory.summary || null,
            memory.ttl_policy,
            memory.created_at, memory.updated_at, memory.last_accessed_at || null
        ];

        try {
            const res = await this.pool.query(query, values);

            await this.recordAuditEvent({
                memory_id: memory.memory_id,
                user_channel_session_id: memory.originating_session_id,
                action: 'CREATE',
                actor_agent_id: memory.owner_agent_id,
                chatbot_channel_id: memory.chatbot_channel_id, // Updated Audit Context
                notes: `Created memory of type ${memory.type} with status ${memory.status}`
            });

            return res.rows[0].memory_id;
        } catch (error) {
            console.error('Failed to create memory block:', error);
            throw new Error(`Memory creation failed: ${(error as Error).message}`);
        }
    }

    /**
     * Update memory status.
     */
    async updateMemoryStatus(
        memoryId: string,
        newStatus: MemoryStatus,
        agentId: string,
        chatbotChannelId: string // Required for audit
    ): Promise<void> {
        const query = `
      UPDATE memory_block
      SET status = $2, updated_at = NOW()
      WHERE memory_id = $1
    `;

        try {
            await this.pool.query(query, [memoryId, newStatus]);

            await this.recordAuditEvent({
                memory_id: memoryId,
                action: 'UPDATE_STATUS',
                actor_agent_id: agentId,
                chatbot_channel_id: chatbotChannelId,
                notes: `Status changed to ${newStatus}`
            });
        } catch (error) {
            console.error('Failed to update memory status:', error);
            throw new Error(`Memory status update failed: ${(error as Error).message}`);
        }
    }

    /**
     * Fetch memory candidates.
     * STRICTLY ENFORCES CHATBOT_CHANNEL_ID ISOLATION.
     */
    async fetchRetrievalCandidates(
        tenantId: string,
        chatbotChannelId: string, // MANDATORY
        userId: string,
        types: MemoryType[],
        minConfidence: number,
        limit: number = 20
    ): Promise<MemoryBlock[]> {
        const query = `
      SELECT * FROM memory_block
      WHERE tenant_id = $1
        AND (chatbot_channel_id = $2 OR chatbot_channel_id = 'GLOBAL') -- Allow local or global
        AND (user_id = $3 OR user_id IS NULL) 
        AND type = ANY($4)
        AND confidence >= $5
        AND status IN ('validated', 'consensus')
        AND strength > 0.1
      ORDER BY strength DESC, created_at DESC
      LIMIT $6
    `;

        try {
            const res = await this.pool.query(query, [tenantId, chatbotChannelId, userId, types, minConfidence, limit]);
            return res.rows as MemoryBlock[];
        } catch (error) {
            console.error('Failed to fetch retrieval candidates:', error);
            throw new Error(`Retrieval fetch failed: ${(error as Error).message}`);
        }
    }

    /**
     * Log all writes for auditability.
     * Swapped channel_domain_id -> chatbot_channel_id
     */
    async recordAuditEvent(event: {
        memory_id?: string,
        user_channel_session_id?: string,
        action: string,
        actor_agent_id?: string,
        chatbot_channel_id?: string,
        notes?: string
    }): Promise<void> {
        const query = `
      INSERT INTO memory_audit_log (
        memory_id, user_channel_session_id, action, 
        actor_agent_id, chatbot_channel_id, notes, timestamp
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NOW()
      )
    `;

        const values = [
            event.memory_id || null,
            event.user_channel_session_id || null,
            event.action,
            event.actor_agent_id || null,
            event.chatbot_channel_id || null,
            event.notes || null
        ];

        try {
            await this.pool.query(query, values);
        } catch (error) {
            console.error('CRITICAL: Failed to record audit event:', error);
        }
    }
}
