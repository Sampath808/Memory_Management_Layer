
import { MockPostgres } from './mocks/MockPostgres';
import { MockRedis } from './mocks/MockRedis';
import { MockMongo } from './mocks/MockMongo';
import { ChatbotChannel } from '../chatbot/ChatbotChannel';
import { SqlMemoryIndex } from '../memory/store/SqlMemoryIndex';
import { LTMStore } from '../memory/ltm/LTMStore';
import { EmbeddingService } from '../memory/ltm/EmbeddingService';
import { IntakeService, ProposedMemory } from '../memory/lifecycle/IntakeService';
import { PromotionService } from '../memory/lifecycle/PromotionService';
import { WhiteboardService } from '../memory/stm/WhiteboardService';
import { MemoryManagerAgent } from '../agents/MemoryManagementAgent';
import {
  MemoryType,
  MemoryStatus,
  TTLPolicy,
  AuthorityLevel,
} from '../memory/types/MemoryBlock';

/**
 * Verify new memory features:
 *  - Whiteboard memory (ephemeral)
 *  - Persona promotion rules (user confirmation required)
 *  - Consensus promotion rules (multi-agent agreement)
 * 
 * Requires OPENAI_API_KEY for embedding generation.
 */
async function verifyNewMemoryFeatures() {
  console.log('--- STARTING VERIFICATION: NEW MEMORY TYPES & RULES ---');

  const mockPg = new MockPostgres();
  const mockRedis = new MockRedis();
  const mockMongo = new MockMongo();

  const sqlIndex = new SqlMemoryIndex(mockPg as any);
  const ltmStore = new LTMStore(mockMongo as any, 'memory-db');

  let embeddingService: EmbeddingService;
  try {
    embeddingService = new EmbeddingService();
  } catch (e) {
    console.warn('⚠️  No OPENAI_API_KEY set. Skipping embedding-dependent tests.');
    console.log('--- VERIFICATION SKIPPED ---');
    return;
  }

  const intakeService = new IntakeService(sqlIndex, ltmStore, embeddingService);
  const promotionService = new PromotionService(sqlIndex);
  const whiteboardService = new WhiteboardService(mockRedis as any);
  const memoryManager = new MemoryManagerAgent(
    intakeService,
    sqlIndex,
    ltmStore,
    embeddingService,
    promotionService,
  );

  const tenantId = 'tenant-123';
  const userId = 'user-abc';
  const chatbotA = ChatbotChannel.createChatbotChannel({
    name: 'LogicBot',
    platform: 'web',
    description: 'Logic and reasoning',
  });

  console.log(`[Setup] Chatbot: ${chatbotA.chatbotChannelId}`);

  // --- TEST 1: WHITEBOARD MEMORY (Ephemeral) ---
  console.log('\n[Test 1] Whiteboard Memory Operations');
  const sessionId = 'session-xyz';

  await whiteboardService.updateWhiteboard(
    sessionId,
    chatbotA.chatbotChannelId,
    'agent-1',
    {
      notes: ['Hypothesis A seems valid'],
      hypotheses: ['If A then B'],
    },
  );

  const wb = await whiteboardService.getWhiteboard(sessionId, chatbotA.chatbotChannelId);
  if (wb && wb.notes.includes('Hypothesis A seems valid')) {
    console.log('✅ Whiteboard Write/Read Successful');
  } else {
    console.error('❌ Whiteboard Write/Read Failed');
  }

  const summary = await whiteboardService.getSummarizedContext(sessionId, chatbotA.chatbotChannelId);
  if (summary.includes('[WHITEBOARD SUMMARY]')) {
    console.log('✅ Whiteboard Summarization Successful');
  }

  // --- TEST 2: PERSONA MEMORY (Strict Validation & Confirmation) ---
  console.log('\n[Test 2] Persona Memory & Promotion Rules');

  const personaProposal: ProposedMemory = {
    type: MemoryType.PERSONA,
    content: 'User prefers concise communication and makes decisions quickly.',
    tenant_id: tenantId,
    user_id: userId,
    chatbot_channel_id: chatbotA.chatbotChannelId,
    metadata: {
      trait_key: 'communication_style',
      trait_value: 'concise',
    },
    source: 'agent',
  };

  const personaId = await intakeService.ingestMemory(personaProposal, 'profiler-agent');
  console.log(`[Persona] Ingested: ${personaId}`);

  // Mock MemoryBlock for promotion tests
  const personaBlock = {
    memory_id: personaId,
    type: MemoryType.PERSONA,
    status: MemoryStatus.DRAFT,
    tenant_id: tenantId,
    user_id: userId,
    chatbot_channel_id: chatbotA.chatbotChannelId,
    confidence: 0.9,
    strength: 1.0,
    authority_level: AuthorityLevel.STANDARD,
    version: 1,
    content_type: 'mongo',
    ttl_policy: TTLPolicy.PERSISTENT,
    created_at: new Date(),
    updated_at: new Date(),
    originating_session_id: sessionId,
  };

  // 2b. Try Promote WITHOUT Confirmation (Should Fail)
  await memoryManager.promoteMemory(
    personaBlock as any,
    MemoryStatus.VALIDATED,
  );

  const failLog = mockPg.auditLogs.find(
    (l) => l.memory_id === personaId && l.action === 'PROMOTION_FAILED',
  );
  if (failLog && failLog.notes.includes('explicit user confirmation')) {
    console.log('✅ Persona Promotion correctly BLOCKED without confirmation');
  } else {
    console.error('❌ Persona Promotion should have failed but didn\'t log correct error.');
  }

  // 2c. Promote WITH Confirmation (Should Succeed)
  await memoryManager.promoteMemory(
    personaBlock as any,
    MemoryStatus.VALIDATED,
    { confirmedByUserId: userId },
  );

  // --- TEST 3: CONSENSUS MEMORY (Multi-Agent Agreement) ---
  console.log('\n[Test 3] Consensus Memory Rules');

  const consensusProposal: ProposedMemory = {
    type: MemoryType.CONSENSUS,
    content: 'The sky is blue due to Rayleigh scattering.',
    tenant_id: tenantId,
    user_id: userId,
    chatbot_channel_id: chatbotA.chatbotChannelId,
    metadata: {
      topic: 'Color of Sky',
      contributing_agents: ['agent-1', 'agent-2'],
      agreement_score: 0.95,
    },
    source: 'system',
  };

  const consensusId = await intakeService.ingestMemory(consensusProposal, 'consensus-agent');
  console.log(`[Consensus] Ingested: ${consensusId}`);

  const consensusBlock = {
    memory_id: consensusId,
    type: MemoryType.CONSENSUS,
    status: MemoryStatus.VALIDATED,
    tenant_id: tenantId,
    user_id: userId,
    chatbot_channel_id: chatbotA.chatbotChannelId,
    confidence: 0.8,
    strength: 1.0,
    authority_level: AuthorityLevel.SYSTEM,
    version: 1,
    content_type: 'mongo',
    ttl_policy: TTLPolicy.CHATBOT,
    created_at: new Date(),
    updated_at: new Date(),
    originating_session_id: sessionId,
  };

  // 3a. Promote with Single Agent (Should Fail)
  await memoryManager.promoteMemory(
    consensusBlock as any,
    MemoryStatus.CONSENSUS,
    { contributingAgents: ['agent-1'], agreementScore: 0.9 },
  );

  const consFailLog1 = mockPg.auditLogs.find(
    (l) => l.memory_id === consensusId && l.notes.includes('at least 2 contributing agents'),
  );
  if (consFailLog1) {
    console.log('✅ Consensus Promotion correctly BLOCKED (Not enough agents)');
  }

  // 3b. Promote with Low Score (Should Fail)
  await memoryManager.promoteMemory(
    consensusBlock as any,
    MemoryStatus.CONSENSUS,
    { contributingAgents: ['agent-1', 'agent-2'], agreementScore: 0.5 },
  );

  const consFailLog2 = mockPg.auditLogs.find(
    (l) => l.memory_id === consensusId && l.notes.includes('agreement score >= 0.7'),
  );
  if (consFailLog2) {
    console.log('✅ Consensus Promotion correctly BLOCKED (Low Agreement Score)');
  }

  // 3c. Success Case
  await memoryManager.promoteMemory(
    consensusBlock as any,
    MemoryStatus.CONSENSUS,
    { contributingAgents: ['agent-1', 'agent-2'], agreementScore: 0.95 },
  );

  console.log('\n--- VERIFICATION COMPLETE ---');
}

verifyNewMemoryFeatures().catch(console.error);
