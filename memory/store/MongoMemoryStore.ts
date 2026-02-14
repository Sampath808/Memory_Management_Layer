
import { MongoClient, Db } from 'mongodb';
import { MemoryType } from '../types/MemoryBlock';

/**
 * Mongo Memory Payload Store (Chatbot-Centric)
 * Stores payload content.
 * - Removed channel_domain_id
 * - Added chatbot_channel_id
 */
export class MongoMemoryStore {
    private db: Db;
    private client: MongoClient;

    constructor(client: MongoClient, dbName: string) {
        this.client = client;
        this.db = this.client.db(dbName);
    }

    private getCollectionName(type: MemoryType): string {
        return `${type}_memory`;
    }

    /**
     * Save a memory payload.
     */
    async savePayload(
        memoryId: string,
        type: MemoryType,
        payload: any,
        metadataContext: {
            tenant_id: string;
            user_id: string;
            chatbot_channel_id: string; // Primary Partition
            originating_session_id?: string;
        }
    ): Promise<void> {
        const collectionName = this.getCollectionName(type);
        const collection = this.db.collection(collectionName);

        const document = {
            _id: memoryId,
            memory_id: memoryId,

            // Structural Metadata
            tenant_id: metadataContext.tenant_id,
            user_id: metadataContext.user_id,
            chatbot_channel_id: metadataContext.chatbot_channel_id,
            originating_session_id: metadataContext.originating_session_id,

            ...payload,

            updated_at: new Date()
        };

        await collection.updateOne(
            { memory_id: memoryId },
            { $set: document },
            { upsert: true }
        );
    }

    /**
     * Retrieve a raw memory payload.
     */
    async loadPayload(memoryId: string, type: MemoryType): Promise<any | null> {
        const collectionName = this.getCollectionName(type);
        const collection = this.db.collection(collectionName);

        const result = await collection.findOne({ _id: memoryId } as any);

        if (!result) return null;
        return result;
    }
}
