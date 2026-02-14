
import { MockPostgres } from './mocks/MockPostgres';
import { MockRedis } from './mocks/MockRedis';
import { MockMongo } from './mocks/MockMongo';
import { STMStore } from '../memory/stm/STMStore';
import { SqlMemoryIndex } from '../memory/store/SqlMemoryIndex';
import { LTMStore, LTMDocument } from '../memory/ltm/LTMStore';
import { EmbeddingService } from '../memory/ltm/EmbeddingService';
import { ChatbotMemoryAssembler } from '../retrieval/ChatbotMemoryAssembler';
import { IntakeService, ProposedMemory } from '../memory/lifecycle/IntakeService';
import { MemoryType, MemoryStatus, AuthorityLevel, TTLPolicy } from '../memory/types/MemoryBlock';

/**
 * Verify Semantic Search (RAG)
 * 
 * Tests: ingest memories → search by natural language → retrieve relevant results.
 * Requires OPENAI_API_KEY for real embeddings.
 */
async function verifySemanticSearch() {
    console.log('--- STARTING VERIFICATION: SEMANTIC SEARCH (RAG) ---');

    const mockPg = new MockPostgres();
    const mockRedis = new MockRedis();
    const mockMongo = new MockMongo();

    const sqlIndex = new SqlMemoryIndex(mockPg as any);
    const ltmStore = new LTMStore(mockMongo as any, 'memory-db');
    const stmStore = new STMStore(mockRedis as any);

    let embeddingService: EmbeddingService;
    try {
        embeddingService = new EmbeddingService();
    } catch (e) {
        console.warn('⚠️  No OPENAI_API_KEY set. Skipping semantic search tests.');
        console.log('--- VERIFICATION SKIPPED ---');
        return;
    }

    const intakeService = new IntakeService(sqlIndex, ltmStore, embeddingService);
    const assembler = new ChatbotMemoryAssembler(stmStore, ltmStore, sqlIndex, embeddingService);

    const tenantId = 'tenant-rag';
    const chatbotId = 'chatbot-rag-1';
    const userId = 'user-rag';
    const sessionId = 'session-rag';

    // Ingest test memories using the real pipeline
    console.log('[Setup] Ingesting test memories...');

    const mem1: ProposedMemory = {
        type: MemoryType.SEMANTIC,
        content: 'The user prefers Python over JavaScript for backend development.',
        tenant_id: tenantId,
        user_id: userId,
        chatbot_channel_id: chatbotId,
        originating_session_id: sessionId,
        metadata: { scope: 'chatbot', tags: ['preferences', 'language'] },
        source: 'user_confirmed',
    };

    const mem2: ProposedMemory = {
        type: MemoryType.SEMANTIC,
        content: 'The user is building a chatbot memory system with MongoDB and PostgreSQL.',
        tenant_id: tenantId,
        user_id: userId,
        chatbot_channel_id: chatbotId,
        originating_session_id: sessionId,
        metadata: { scope: 'chatbot', tags: ['project', 'tech-stack'] },
        source: 'system',
    };

    await intakeService.ingestMemory(mem1, 'test-agent');
    await intakeService.ingestMemory(mem2, 'test-agent');
    console.log('[Setup] Seeded 2 memories with real embeddings');

    // Test RAG Retrieval
    console.log('\n[Test] Asking: "What language does the user prefer?"');
    const contextA = await assembler.assembleContext({
        userChannelSessionId: sessionId,
        chatbotChannelId: chatbotId,
        tenantId, userId,
        agentRole: 'assistant',
        workflowStep: 'chat',
        tokenBudget: 1000,
        queryText: 'What programming language does the user prefer?',
    });

    console.log('--- RAG Context Result ---');
    console.log(contextA);
    console.log('✅ Semantic search completed (check output for relevance)');

    // Rate Limit Test
    console.log('\n[Test] Sending huge query (guard test)...');
    const hugeQuery = 'A'.repeat(1000);
    await assembler.assembleContext({
        userChannelSessionId: sessionId,
        chatbotChannelId: chatbotId,
        tenantId, userId,
        agentRole: 'assistant',
        workflowStep: 'chat',
        tokenBudget: 1000,
        queryText: hugeQuery,
    });
    console.log('✅ System handled huge query gracefully');

    console.log('--- VERIFICATION COMPLETE ---');
}

verifySemanticSearch().catch(console.error);
