
import { Pool } from 'pg';
import { ChatbotChannelConfig } from '../../chatbot/ChatbotChannel';

export interface ChatbotRecord {
    chatbot_channel_id: string;
    tenant_id: string;
    name: string;
    platform: string;
    description?: string;
    created_at: Date;
    status: 'active' | 'inactive';
}

/**
 * SQL Chatbot Registry (Phase 7)
 * Manages the canonical list of chatbot channels.
 * No more hardcoding!
 */
export class SqlChatbotRegistry {
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    /**
     * Register a new chatbot channel.
     */
    async registerChatbot(record: Omit<ChatbotRecord, 'created_at'>): Promise<void> {
        const query = `
      INSERT INTO chatbot_channels (
        chatbot_channel_id, tenant_id, name, platform, description, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (chatbot_channel_id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        status = EXCLUDED.status
    `;

        await this.pool.query(query, [
            record.chatbot_channel_id,
            record.tenant_id,
            record.name,
            record.platform,
            record.description,
            record.status
        ]);
    }

    /**
     * Get chatbot metadata.
     */
    async getChatbot(chatbotChannelId: string): Promise<ChatbotRecord | null> {
        const res = await this.pool.query(
            'SELECT * FROM chatbot_channels WHERE chatbot_channel_id = $1',
            [chatbotChannelId]
        );
        return res.rows[0] || null;
    }

    /**
     * List all chatbots for a tenant.
     */
    async listChatbots(tenantId: string): Promise<ChatbotRecord[]> {
        const res = await this.pool.query(
            'SELECT * FROM chatbot_channels WHERE tenant_id = $1',
            [tenantId]
        );
        return res.rows;
    }

    /**
     * Check if a chatbot exists.
     */
    async exists(chatbotChannelId: string): Promise<boolean> {
        const res = await this.pool.query(
            'SELECT 1 FROM chatbot_channels WHERE chatbot_channel_id = $1 LIMIT 1',
            [chatbotChannelId]
        );
        return res.rowCount > 0;
    }
}
