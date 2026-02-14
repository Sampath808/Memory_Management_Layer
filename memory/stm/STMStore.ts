
import Redis from 'ioredis';
import { STMState } from './STMState';

/**
 * Short-Term Memory Store (Redis, Session-Keyed)
 * Stores session-scoped STM state.
 * Primary Key: userChannelSessionID
 * Domain Metadata: NONE (Implicitly bound to session)
 * Expires when session closes (or TTL).
 * 
 * UPDATED PROMPT 19 (Chatbot-Centric)
 */
export class STMStore {
    private redis: Redis;

    constructor(dependency: string | Redis) {
        if (typeof dependency === 'string') {
            this.redis = new Redis(dependency);
        } else {
            this.redis = dependency;
        }
    }

    private getKey(userChannelSessionId: string): string {
        // Simple key, no domain prefix needed as session ID is globally unique
        return `stm:${userChannelSessionId}`;
    }

    /**
     * Load the current STM state for a session.
     */
    async loadSTM(userChannelSessionId: string): Promise<STMState | null> {
        const data = await this.redis.get(this.getKey(userChannelSessionId));
        if (!data) return null;
        return JSON.parse(data) as STMState;
    }

    /**
     * Rewrite the STM state.
     */
    async rewriteSTM(newState: STMState): Promise<void> {
        const key = this.getKey(newState.userChannelSessionId);

        // Set with TTL (e.g., 30 minutes inactivity)
        await this.redis.set(key, JSON.stringify(newState), 'EX', 1800);
    }

    /**
     * Clear STM when session ends.
     */
    async clearSTM(userChannelSessionId: string): Promise<void> {
        await this.redis.del(this.getKey(userChannelSessionId));
    }
}
