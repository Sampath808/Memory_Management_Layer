
/**
 * Mock MongoDB (Simulated)
 */
export class MockMongo {
    public collections: Record<string, any[]> = {};

    constructor(uri?: string) {
        console.log('[MockMongo] Initialized');
    }

    // Simulate db() call
    db(dbName?: string) {
        return this;
    }

    // Simulate collection() call
    collection(name: string) {
        if (!this.collections[name]) {
            this.collections[name] = [];
        }
        return {
            insertOne: async (doc: any) => {
                this.collections[name].push(doc);
                return { insertedId: doc._id };
            },
            updateOne: async (query: any, update: any, options: any) => {
                // Simple mock: assume update is {$set: ...} and query is {_id: ...} or {memory_id: ...}
                const id = query._id || query.memory_id;
                const existingIndex = this.collections[name].findIndex(d => d._id === id || d.memory_id === id);

                const setter = update.$set || {};

                if (existingIndex >= 0) {
                    Object.assign(this.collections[name][existingIndex], setter);
                    return { modifiedCount: 1, upsertedCount: 0 };
                } else if (options?.upsert) {
                    this.collections[name].push({ ...setter, ...query }); // Creating new
                    return { modifiedCount: 0, upsertedCount: 1 };
                }
                return { modifiedCount: 0 };
            },
            findOne: async (query: any) => {
                const id = query._id || query.memory_id;
                // Simple search
                if (id) {
                    return this.collections[name].find(d => d._id === id || d.memory_id === id) || null;
                }
                // Fallback for userChannelSessionId
                if (query.userChannelSessionId) {
                    // Mock findOne logic for ChatHistory, return last one for simplicity or null
                    // In real app we use find().toArray() usually
                    return null;
                }
                return null;
            },
            find: (query: any) => {
                // Return a chainable mock cursor
                const results = this.collections[name].filter(d => {
                    // Basic matching
                    for (const key in query) {
                        if (d[key] !== query[key]) return false;
                    }
                    return true;
                });

                return {
                    sort: (s: any) => ({
                        skip: (sk: number) => ({
                            limit: (l: number) => ({
                                toArray: async () => results.slice(sk, sk + l)
                            })
                        })
                    }),
                    toArray: async () => results
                };
            },
            aggregate: (pipeline: any[]) => {
                // Mock Aggregation for Vector Search
                console.log('[MockMongo] Aggregation Pipeline:', JSON.stringify(pipeline));

                // If vector search, just return all documents in collection that match filter (if any)
                // or just return all for simplicity in mock
                const vectorStage = pipeline.find(s => s.$vectorSearch);
                if (vectorStage) {
                    const filter = vectorStage.$vectorSearch.filter;
                    const results = this.collections[name].filter(d => {
                        if (filter) {
                            if (filter.chatbot_channel_id && d.chatbot_channel_id !== filter.chatbot_channel_id) return false;
                            if (filter.tenant_id && d.tenant_id !== filter.tenant_id) return false;
                        }
                        return true;
                    });

                    // Mock shape projection
                    const projected = results.map(d => ({
                        memory_id: d.memory_id,
                        fact: d.fact,
                        confidence: d.confidence,
                        source: d.source,
                        score: 0.95
                    }));
                    return { toArray: async () => projected };
                }
                return { toArray: async () => [] };
            }
        };
    }
}
