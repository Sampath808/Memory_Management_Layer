
/**
 * Mock Redis Client (Simulated)
 */
export class MockRedis {
    public store: Record<string, string> = {};

    constructor() {
        console.log('[MockRedis] Initialized');
    }

    async get(key: string): Promise<string | null> {
        return this.store[key] || null;
    }

    async set(key: string, value: string, mode?: string, ttl?: number): Promise<string> {
        this.store[key] = value;
        return 'OK';
    }

    async del(key: string): Promise<number> {
        if (this.store[key]) {
            delete this.store[key];
            return 1;
        }
        return 0;
    }
}
