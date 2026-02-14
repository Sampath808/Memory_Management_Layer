
import { Pool } from 'pg';
import { TTLPolicy } from '../types/MemoryBlock';

/**
 * Memory Decay Service (Chatbot-Centric)
 * UPDATED FOR TTL POLICY: SESSION | CHATBOT | PERSISTENT
 */
export class DecayService {
    private pool: Pool;

    constructor(connectionString: string) {
        this.pool = new Pool({ connectionString });
    }

    async runDecayCycle(): Promise<void> {
        console.log('[DecayService] Starting decay cycle...');

        // 1. Session Memory -> Very fast decay (if not accessed)
        await this.applyDecay(TTLPolicy.SESSION, 0.1);

        // 2. Chatbot LTM -> Slow decay
        await this.applyDecay(TTLPolicy.CHATBOT, 0.01);

        // 3. Persistent -> No decay

        console.log('[DecayService] Decay cycle complete.');
    }

    private async applyDecay(policy: TTLPolicy, decayRate: number): Promise<void> {
        const decayFactor = 1 - decayRate;

        const query = `
      UPDATE memory_block
      SET strength = strength * $1
      WHERE ttl_policy = $2
        AND strength > 0.01
        AND status != 'deprecated'
    `;

        try {
            const res = await this.pool.query(query, [decayFactor, policy]);
            console.log(`[DecayService] Applied decay to ${res.rowCount} memories of type ${policy}`);
        } catch (error) {
            console.error(`[DecayService] Failed to decay memories of type ${policy}:`, error);
        }
    }
}
