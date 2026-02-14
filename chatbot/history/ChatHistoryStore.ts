
import { MongoClient, Db } from 'mongodb';

export interface ChatMessage {
    userChannelSessionId: string;
    chatbotChannelId: string; // Metadata for analytics/audit
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, any>;
    timestamp: Date;
}

/**
 * Chat History Store (Session-Scoped)
 * Stores verbatim messages. Keyed by session ID.
 * NO MORE DOMAIN ID - History is flat per session.
 * 
 * UPDATED PROMPT 17 (Chatbot-Centric)
 */
export class ChatHistoryStore {
    private db: Db;
    private collectionName = 'chat_history';

    constructor(client: MongoClient, dbName: string) {
        this.db = client.db(dbName);
    }

    /**
     * Append a message to the history.
     * Enforces session context.
     */
    async appendMessage(
        userChannelSessionId: string,
        chatbotChannelId: string, // passed for record-keeping
        role: 'user' | 'assistant' | 'system',
        content: string,
        metadata?: Record<string, any>
    ): Promise<void> {
        const collection = this.db.collection(this.collectionName);

        const message: ChatMessage = {
            userChannelSessionId,
            chatbotChannelId,
            role,
            content,
            metadata,
            timestamp: new Date()
        };

        await collection.insertOne(message);
    }

    /**
     * Retrieve conversation history for a session.
     */
    async getConversation(
        userChannelSessionId: string,
        limit: number = 50,
        offset: number = 0
    ): Promise<ChatMessage[]> {
        const collection = this.db.collection(this.collectionName);

        return await collection
            .find({ userChannelSessionId })
            .sort({ timestamp: -1 })
            .skip(offset)
            .limit(limit)
            .toArray() as unknown as ChatMessage[];
    }
}
