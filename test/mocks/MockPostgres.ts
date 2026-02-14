
/**
 * Mock Postgres Pool (Simulated)
 */
export class MockPostgres {
    public memoryBlocks: any[] = [];
    public auditLogs: any[] = [];

    constructor(connectionString?: string) {
        console.log('[MockPostgres] Initialized');
    }

    async query(text: string, params: any[] = []): Promise<any> {
        const trimmed = text.trim().toUpperCase();

        // INSERT INTO memory_block
        if (trimmed.startsWith('INSERT INTO MEMORY_BLOCK')) {
            const block = {
                memory_id: params[0],
                type: params[1],
                status: params[2],
                tenant_id: params[3],
                user_id: params[4],
                chatbot_channel_id: params[5],
                originating_session_id: params[6],
                owner_agent_id: params[7],
                authority_level: params[8],
                confidence: params[9],
                strength: params[10],
                version: params[11],
                parent_memory_id: params[12],
                content_type: params[13],
                content_ref: params[14],
                summary: params[15],
                ttl_policy: params[16],
                created_at: params[17],
                updated_at: params[18],
                last_accessed_at: params[19]
            };
            this.memoryBlocks.push(block);
            return { rows: [{ memory_id: block.memory_id }], rowCount: 1 };
        }

        // UPDATE memory_block SET status
        if (trimmed.startsWith('UPDATE MEMORY_BLOCK') && trimmed.includes('SET STATUS')) {
            const memoryId = params[0]; // Assuming WHERE memory_id = $1
            const newStatus = params[1];
            const block = this.memoryBlocks.find(b => b.memory_id === memoryId);
            if (block) {
                block.status = newStatus;
                return { rowCount: 1 };
            }
            return { rowCount: 0 };
        }

        // SELECT * FROM memory_block (Retrieval)
        if (trimmed.startsWith('SELECT * FROM MEMORY_BLOCK')) {
            const tenantId = params[0];
            const chatbotChannelId = params[1];
            // simplified filter logic for mock
            const results = this.memoryBlocks.filter(b =>
                b.tenant_id === tenantId &&
                (b.chatbot_channel_id === chatbotChannelId || b.chatbot_channel_id === 'GLOBAL')
            );
            return { rows: results, rowCount: results.length };
        }

        // INSERT INTO memory_audit_log
        if (trimmed.startsWith('INSERT INTO MEMORY_AUDIT_LOG')) {
            const log = {
                memory_id: params[0],
                user_channel_session_id: params[1],
                action: params[2],
                actor_agent_id: params[3],
                chatbot_channel_id: params[4],
                notes: params[5],
                timestamp: new Date()
            };
            this.auditLogs.push(log);
            return { rowCount: 1 };
        }

        // Default Fallback
        console.warn('[MockPostgres] Unhandled query:', text);
        return { rows: [], rowCount: 0 };
    }
}
