
import Redis from 'ioredis';
import { WhiteboardMemory } from './WhiteboardMemory';

/**
 * Whiteboard Service
 * Manages ephemeral shared reasoning space for agents.
 */
export class WhiteboardService {
    private redis: Redis;
    private readonly TTL = 3600; // 1 hour by default

    constructor(redis: Redis) {
        this.redis = redis;
    }

    private getKey(sessionId: string, chatbotChannelId: string): string {
        return `whiteboard:${chatbotChannelId}:${sessionId}`;
    }

    /**
     * Get the current whiteboard state
     */
    async getWhiteboard(sessionId: string, chatbotChannelId: string): Promise<WhiteboardMemory | null> {
        const data = await this.redis.get(this.getKey(sessionId, chatbotChannelId));
        if (!data) return null;
        return JSON.parse(data) as WhiteboardMemory;
    }

    /**
     * Update whiteboard with new notes/hypotheses
     */
    async updateWhiteboard(
        sessionId: string,
        chatbotChannelId: string,
        agentId: string,
        updates: Partial<Pick<WhiteboardMemory, 'notes' | 'hypotheses' | 'intermediate_results'>>
    ): Promise<void> {
        const key = this.getKey(sessionId, chatbotChannelId);
        const current = await this.getWhiteboard(sessionId, chatbotChannelId) || {
            session_id: sessionId,
            chatbot_channel_id: chatbotChannelId,
            notes: [],
            hypotheses: [],
            intermediate_results: [],
            last_updated_by_agent: agentId,
            ttl_expiry: Math.floor(Date.now() / 1000) + this.TTL
        };

        const updated: WhiteboardMemory = {
            ...current,
            notes: [...current.notes, ...(updates.notes || [])],
            hypotheses: [...current.hypotheses, ...(updates.hypotheses || [])],
            intermediate_results: [...current.intermediate_results, ...(updates.intermediate_results || [])],
            last_updated_by_agent: agentId,
            ttl_expiry: Math.floor(Date.now() / 1000) + this.TTL
        };

        await this.redis.set(key, JSON.stringify(updated), 'EX', this.TTL);
    }

    /**
     * Summarize whiteboard for context injection
     */
    async getSummarizedContext(sessionId: string, chatbotChannelId: string): Promise<string> {
        const whiteboard = await this.getWhiteboard(sessionId, chatbotChannelId);
        if (!whiteboard) return "";

        return `
[WHITEBOARD SUMMARY]
Notes: ${whiteboard.notes.slice(-5).join('; ')}
Hypotheses: ${whiteboard.hypotheses.slice(-3).join('; ')}
Last updated by: ${whiteboard.last_updated_by_agent}
        `.trim();
    }
}
