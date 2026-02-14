
import { MockPostgres } from './mocks/MockPostgres';
import { MockRedis } from './mocks/MockRedis';
import { MockMongo } from './mocks/MockMongo';
import { ChatbotChannel } from '../chatbot/ChatbotChannel';
import { UserChannelSession } from '../chatbot/session/UserChannelSession';
import { ChatHistoryStore } from '../chatbot/history/ChatHistoryStore';
import { STMStore } from '../memory/stm/STMStore';
import { STMState } from '../memory/stm/STMState';
import { SqlMemoryIndex } from '../memory/store/SqlMemoryIndex';
import { LTMStore } from '../memory/ltm/LTMStore';
import { EmbeddingService } from '../memory/ltm/EmbeddingService';
import { IntakeService, ProposedMemory } from '../memory/lifecycle/IntakeService';
import { ChatbotMemoryAssembler } from '../retrieval/ChatbotMemoryAssembler';
import { MemoryType, MemoryStatus, TTLPolicy } from '../memory/types/MemoryBlock';

/**
 * System Verification Test
 * 
 * Tests the core flow: ingest memory → save to LTM → retrieve via assembler.
 * Uses mock databases but real EmbeddingService (requires OPENAI_API_KEY).
 * 
 * To run without OpenAI key, set MOCK_EMBEDDINGS=true in env.
 */
async function verifySystem() {
    console.log('--- STARTING VERIFICATION: UNIFIED MEMORY SYSTEM ---');

    // 1. Initialize Mocks
    const mockPg = new MockPostgres();
    const mockMongo = new MockMongo();
    const mockRedis = new MockRedis();

    const sqlIndex = new SqlMemoryIndex(mockPg as any);
    const ltmStore = new LTMStore(mockMongo as any, 'memory-db');
    const stmStore = new STMStore(mockRedis as any);
    const chatStore = new ChatHistoryStore(mockMongo as any, 'history-db');

    // Embedding service — if no API key, tests will fail gracefully
    let embeddingService: EmbeddingService;
    try {
        embeddingService = new EmbeddingService();
    } catch (e) {
        console.warn('⚠️  No OPENAI_API_KEY set. Skipping embedding-dependent tests.');
        console.log('--- VERIFICATION SKIPPED ---');
        return;
    }

    const intakeService = new IntakeService(sqlIndex, ltmStore, embeddingService);
    const assembler = new ChatbotMemoryAssembler(stmStore, ltmStore, sqlIndex, embeddingService);

    // 2. Setup
    const tenantId = 'tenant-123';
    const userId = 'user-abc';

    const chatbotA = ChatbotChannel.createChatbotChannel({
        name: 'MathBot',
        platform: 'teams',
        description: 'Helps with algebra'
    });
    console.log(`[Setup] Created Chatbot A: ${chatbotA.chatbotChannelId}`);

    const chatbotB = ChatbotChannel.createChatbotChannel({
        name: 'ScienceBot',
        platform: 'slack',
        description: 'Helps with physics'
    });
    console.log(`[Setup] Created Chatbot B: ${chatbotB.chatbotChannelId}`);

    const session = UserChannelSession.createUserChannelSession(tenantId, userId, chatbotA.chatbotChannelId);
    console.log(`[Session] Started: ${session.userChannelSessionId}`);

    // 3. Chat + STM
    await chatStore.appendMessage(session.userChannelSessionId, chatbotA.chatbotChannelId, 'user', 'I need help with algebra.');
    console.log('[Chat] User message logged');

    const stmState: STMState = {
        userChannelSessionId: session.userChannelSessionId,
        chatbotChannelId: chatbotA.chatbotChannelId,
        focus_entity_ids: ['algebra'],
        pending_actions: ['solve_equation'],
        summarized_state: 'User is asking about algebra.',
        last_updated_at: new Date()
    };
    await stmStore.rewriteSTM(stmState);
    console.log('[STM] State updated');

    // 4. Ingest LTM — the new way
    const proposal: ProposedMemory = {
        type: MemoryType.EPISODIC,
        content: 'User successfully solved a quadratic equation: x^2 + 2x + 1 = 0. The difficulty was easy.',
        tenant_id: tenantId,
        user_id: userId,
        chatbot_channel_id: chatbotA.chatbotChannelId,
        originating_session_id: session.userChannelSessionId,
        metadata: {
            entities: ['quadratic equation', 'algebra'],
            outcome: 'solved_successfully',
        },
    };

    const memId = await intakeService.ingestMemory(proposal, 'math-agent-1');
    console.log(`[LTM] Ingested memory: ${memId}`);
    console.log('✅ Memory ingestion with real embeddings successful');

    // 5. Context Assembly
    console.log('\n[Retrieval] Assembling context for Chatbot A...');
    const contextA = await assembler.assembleContext({
        userChannelSessionId: session.userChannelSessionId,
        chatbotChannelId: chatbotA.chatbotChannelId,
        tenantId, userId,
        agentRole: 'tutor',
        workflowStep: 'start',
        tokenBudget: 1000,
        queryText: 'What equations has the user worked on?',
    });

    console.log('--- Context A Result ---');
    console.log(contextA);

    if (contextA.includes('algebra')) {
        console.log('✅ TEST PASSED: STM context retrieved');
    } else {
        console.error('❌ TEST FAILED: STM context missing');
    }

    console.log('\n--- VERIFICATION COMPLETE ---');
}

verifySystem().catch(err => console.error(err));
