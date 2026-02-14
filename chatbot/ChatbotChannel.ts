
import { randomUUID } from 'crypto';

/**
 * Chatbot Channel Configuration
 */
export interface ChatbotChannelConfig {
    name: string;
    platform: 'web' | 'teams' | 'slack' | 'api' | 'other';
    description?: string;
    // Additional config like API keys, model preferences, etc.
}

/**
 * Chatbot Channel (Canonical Identity)
 * Represents a SINGLE deployed chatbot instance.
 * - Identified by chatbot_channel_id
 * - Acts as the primary partition for all Long-Term Memory (LTM).
 * - No "sub-domains" - the Channel IS the Domain.
 * 
 * UPDATED PROMPT 15 (Chatbot-Centric)
 */
export class ChatbotChannel {
    readonly chatbotChannelId: string;
    public name: string;
    public platform: 'web' | 'teams' | 'slack' | 'api' | 'other';
    public description?: string;
    readonly createdAt: Date;

    constructor(config: ChatbotChannelConfig) {
        this.chatbotChannelId = randomUUID();
        this.name = config.name;
        this.platform = config.platform;
        this.description = config.description;
        this.createdAt = new Date();
    }

    /**
     * Factory method to create a new Chatbot Channel.
     */
    static createChatbotChannel(config: ChatbotChannelConfig): ChatbotChannel {
        return new ChatbotChannel(config);
    }

    /**
     * Get the identity of this channel.
     */
    getIdentity(): { id: string; name: string; platform: string } {
        return {
            id: this.chatbotChannelId,
            name: this.name,
            platform: this.platform
        };
    }
}
