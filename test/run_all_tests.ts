// @ts-nocheck
/**
 * GoChannel Memory System — Comprehensive Test Suite
 * 
 * Tests the unified memory architecture:
 *   - LTMStore (unified Mongo)
 *   - EmbeddingService (OpenAI)
 *   - IntakeService (ingestion pipeline)
 *   - PromotionService (lifecycle governance)
 *   - ConflictResolver (deterministic resolution)
 *   - STM (session-scoped state)
 *   - Chatbot Isolation (cross-chatbot scoping)
 *   - Session Management
 *   - MemoryManagerAgent (governance engine)
 * 
 * Note: Suites that require real OpenAI embeddings are skipped
 * if OPENAI_API_KEY is not set.
 */

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
import { PromotionService } from '../memory/lifecycle/PromotionService';
import { ConflictResolver, ConflictResult } from '../memory/lifecycle/ConflictResolver';
import { ChatbotMemoryAssembler } from '../retrieval/ChatbotMemoryAssembler';
import { HierarchicalSummarizer, SummaryDepth } from '../memory/summarization/HierarchicalSummarizer';
import { MemoryManagerAgent } from '../agents/MemoryManagementAgent';
import {
  MemoryType,
  MemoryStatus,
  AuthorityLevel,
  TTLPolicy,
} from '../memory/types/MemoryBlock';

// ============================================================
// Test Harness
// ============================================================

let passed = 0;
let failed = 0;
const results: string[] = [];

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passed++;
    results.push(`  PASS: ${testName}`);
  } else {
    failed++;
    results.push(`  FAIL: ${testName}${detail ? ' -- ' + detail : ''}`);
  }
}

// ============================================================
// Infrastructure Setup
// ============================================================

function createInfra() {
  const mockPg = new MockPostgres();
  const mockRedis = new MockRedis();
  const mockMongo = new MockMongo();

  const sqlIndex = new SqlMemoryIndex(mockPg as any);
  const ltmStore = new LTMStore(mockMongo as any, 'memory-db');
  const stmStore = new STMStore(mockRedis as any);
  const chatStore = new ChatHistoryStore(mockMongo as any, 'history-db');
  const promotionService = new PromotionService(sqlIndex);
  const conflictResolver = new ConflictResolver(sqlIndex);

  return {
    mockPg,
    mockRedis,
    mockMongo,
    sqlIndex,
    ltmStore,
    stmStore,
    chatStore,
    promotionService,
    conflictResolver,
  };
}

/**
 * Create infrastructure with real embedding service.
 * Returns null if OPENAI_API_KEY is not set.
 */
function createInfraWithEmbeddings() {
  const base = createInfra();

  let embeddingService: EmbeddingService;
  try {
    embeddingService = new EmbeddingService();
  } catch (e) {
    return null;
  }

  const intakeService = new IntakeService(base.sqlIndex, base.ltmStore, embeddingService);
  const assembler = new ChatbotMemoryAssembler(
    base.stmStore,
    base.ltmStore,
    base.sqlIndex,
    embeddingService,
  );
  const memoryManager = new MemoryManagerAgent(
    intakeService,
    base.sqlIndex,
    base.ltmStore,
    embeddingService,
    base.promotionService,
  );

  return {
    ...base,
    embeddingService,
    intakeService,
    assembler,
    memoryManager,
  };
}

// ============================================================
// TEST SUITE 1: Promotion Service (No Embeddings Needed)
// ============================================================

async function testPromotionService() {
  console.log('\n[Suite 1] PROMOTION SERVICE');
  const infra = createInfra();

  const draftBlock = {
    memory_id: 'mem-promo-1',
    type: MemoryType.EPISODIC,
    status: MemoryStatus.DRAFT,
    tenant_id: 't1',
    user_id: 'u1',
    chatbot_channel_id: 'cb-1',
    originating_session_id: 's1',
    owner_agent_id: 'agent-1',
    authority_level: AuthorityLevel.STANDARD,
    confidence: 0.8,
    strength: 1.0,
    version: 1,
    content_type: 'mongo' as const,
    ttl_policy: TTLPolicy.CHATBOT,
    created_at: new Date(),
    updated_at: new Date(),
  };

  // 1.1: Valid DRAFT -> VALIDATED
  const result1 = await infra.promotionService.promoteMemory(
    draftBlock,
    MemoryStatus.VALIDATED,
    'system-agent',
  );
  assert(result1 === true, '1.1 DRAFT -> VALIDATED succeeds with confidence >= 0.4');

  // 1.2: Invalid DRAFT -> CONSENSUS (skipping VALIDATED)
  const draftBlock2 = { ...draftBlock, memory_id: 'mem-promo-2', status: MemoryStatus.DRAFT };
  const result2 = await infra.promotionService.promoteMemory(
    draftBlock2,
    MemoryStatus.CONSENSUS,
    'system-agent',
  );
  assert(result2 === false, '1.2 DRAFT -> CONSENSUS (skip) is rejected');

  // 1.3: Low confidence rejection
  const lowConfBlock = { ...draftBlock, memory_id: 'mem-promo-3', confidence: 0.2 };
  const result3 = await infra.promotionService.promoteMemory(
    lowConfBlock,
    MemoryStatus.VALIDATED,
    'system-agent',
  );
  assert(result3 === false, '1.3 Promotion rejected when confidence < 0.4');

  // 1.4: Deprecated is terminal
  const depBlock = { ...draftBlock, memory_id: 'mem-promo-4', status: MemoryStatus.DEPRECATED };
  const result4 = await infra.promotionService.promoteMemory(
    depBlock,
    MemoryStatus.VALIDATED,
    'system-agent',
  );
  assert(result4 === false, '1.4 DEPRECATED is terminal - cannot promote');
}

// ============================================================
// TEST SUITE 2: Conflict Resolution (No Embeddings Needed)
// ============================================================

async function testConflictResolver() {
  console.log('\n[Suite 2] CONFLICT RESOLUTION');
  const infra = createInfra();

  const baseBlock = {
    memory_id: 'mem-a',
    type: MemoryType.SEMANTIC,
    status: MemoryStatus.VALIDATED,
    tenant_id: 't',
    user_id: 'u',
    chatbot_channel_id: 'cb',
    authority_level: AuthorityLevel.STANDARD,
    confidence: 0.8,
    strength: 1.0,
    version: 1,
    content_type: 'mongo' as const,
    ttl_policy: TTLPolicy.CHATBOT,
    created_at: new Date(),
    updated_at: new Date(),
  };

  // 2.1: Consensus beats non-consensus
  const consensus = { ...baseBlock, memory_id: 'a', status: MemoryStatus.CONSENSUS };
  const validated = { ...baseBlock, memory_id: 'b', status: MemoryStatus.VALIDATED };
  const r1 = await infra.conflictResolver.resolve(consensus, validated);
  assert(r1 === ConflictResult.RESOLVED_A_WINS, '2.1 Consensus beats Validated');

  // 2.2: Higher authority wins
  const expert = { ...baseBlock, memory_id: 'c', authority_level: AuthorityLevel.EXPERT };
  const guest = { ...baseBlock, memory_id: 'd', authority_level: AuthorityLevel.GUEST };
  const r2 = await infra.conflictResolver.resolve(expert, guest);
  assert(r2 === ConflictResult.RESOLVED_A_WINS, '2.2 EXPERT authority beats GUEST');

  // 2.3: Significantly higher confidence wins
  const highConf = { ...baseBlock, memory_id: 'e', confidence: 0.9 };
  const lowConf = { ...baseBlock, memory_id: 'f', confidence: 0.5 };
  const r3 = await infra.conflictResolver.resolve(highConf, lowConf);
  assert(r3 === ConflictResult.RESOLVED_A_WINS, '2.3 Higher confidence wins (diff >= 0.2)');

  // 2.4: Similar scores = UNRESOLVED
  const equal1 = { ...baseBlock, memory_id: 'g', confidence: 0.7 };
  const equal2 = { ...baseBlock, memory_id: 'h', confidence: 0.75 };
  const r4 = await infra.conflictResolver.resolve(equal1, equal2);
  assert(r4 === ConflictResult.UNRESOLVED, '2.4 Similar confidence = UNRESOLVED');
}

// ============================================================
// TEST SUITE 3: STM (No Embeddings Needed)
// ============================================================

async function testSTM() {
  console.log('\n[Suite 3] SHORT-TERM MEMORY (STM)');
  const infra = createInfra();

  const sessionId = 'session-stm-1';
  const chatbotId = 'cb-stm-1';

  // 3.1: Write and read STM
  const state: STMState = {
    userChannelSessionId: sessionId,
    chatbotChannelId: chatbotId,
    active_intent: 'solve_equation',
    focus_entity_ids: ['algebra', 'quadratic'],
    pending_actions: ['show_solution'],
    summarized_state: 'User is solving quadratics.',
    last_updated_at: new Date(),
  };
  await infra.stmStore.rewriteSTM(state);
  const loaded = await infra.stmStore.loadSTM(sessionId);
  assert(loaded !== null, '3.1 STM can be written and read back');
  assert(loaded?.active_intent === 'solve_equation', '3.2 STM intent preserved');
  assert(loaded?.focus_entity_ids.length === 2, '3.3 STM focus entities preserved');

  // 3.2: STM rewrite overwrites
  const newState: STMState = {
    ...state,
    active_intent: 'review_answer',
    summarized_state: 'User reviewing the solution.',
  };
  await infra.stmStore.rewriteSTM(newState);
  const reloaded = await infra.stmStore.loadSTM(sessionId);
  assert(reloaded?.active_intent === 'review_answer', '3.4 STM rewrite replaces previous state');

  // 3.3: Clear STM
  await infra.stmStore.clearSTM(sessionId);
  const cleared = await infra.stmStore.loadSTM(sessionId);
  assert(cleared === null, '3.5 STM cleared on session end');

  // 3.4: Non-existent session returns null
  const noSession = await infra.stmStore.loadSTM('nonexistent');
  assert(noSession === null, '3.6 Non-existent session returns null');
}

// ============================================================
// TEST SUITE 4: Session Management (No Embeddings Needed)
// ============================================================

async function testSessionManagement() {
  console.log('\n[Suite 4] SESSION MANAGEMENT');

  // 4.1: Valid session creation
  const session = UserChannelSession.createUserChannelSession('t1', 'u1', 'cb1');
  assert(session.isActive(), '4.1 New session is active');
  assert(session.tenantId === 't1', '4.2 Session preserves tenantId');
  assert(session.chatbotChannelId === 'cb1', '4.3 Session preserves chatbotChannelId');

  // 4.2: Session close
  session.closeSession();
  assert(!session.isActive(), '4.4 Session can be closed');
  assert(session.endedAt !== undefined, '4.5 Closed session has endedAt');

  // 4.3: Double close is safe
  session.closeSession();
  assert(!session.isActive(), '4.6 Double close is idempotent');

  // 4.4: Missing fields throws
  let threw = false;
  try {
    UserChannelSession.createUserChannelSession('', 'u1', 'cb1');
  } catch {
    threw = true;
  }
  assert(threw, '4.7 Missing tenantId throws error');
}

// ============================================================
// TEST SUITE 5: Memory Ingestion (Requires Embeddings)
// ============================================================

async function testMemoryIngestion() {
  console.log('\n[Suite 5] MEMORY INGESTION (Unified Pipeline)');
  const infra = createInfraWithEmbeddings();
  if (!infra) {
    console.log('  ⏩ Skipped (no OPENAI_API_KEY)');
    return;
  }

  const tenantId = 'tenant-ingest';
  const userId = 'user-ingest';
  const chatbotId = 'chatbot-ingest';
  const sessionId = 'session-ingest';

  // 5.1: Ingest an episodic memory
  const memId = await infra.intakeService.ingestMemory(
    {
      type: MemoryType.EPISODIC,
      content: 'User solved a quadratic equation: x^2 + 2x + 1 = 0',
      tenant_id: tenantId,
      user_id: userId,
      chatbot_channel_id: chatbotId,
      originating_session_id: sessionId,
      metadata: { entities: ['quadratic', 'algebra'], outcome: 'solved' },
    },
    'agent-1',
  );
  assert(typeof memId === 'string' && memId.length > 0, '5.1 Memory ingestion returns valid ID');

  // 5.2: Verify PG index entry
  const block = infra.mockPg.memoryBlocks.find((b: any) => b.memory_id === memId);
  assert(block !== undefined, '5.2 Memory block exists in SQL index');
  assert(block?.status === MemoryStatus.DRAFT, '5.3 Ingested memory starts as DRAFT');
  assert(block?.confidence === 0.5, '5.4 Episodic memory gets 0.5 initial confidence (not 0.1)');
  assert(block?.chatbot_channel_id === chatbotId, '5.5 Memory scoped to correct chatbot');

  // 5.3: Verify audit log
  const auditLogs = infra.mockPg.auditLogs.filter((l: any) => l.memory_id === memId);
  assert(auditLogs.length > 0, '5.6 Audit log entry created on ingestion');
  assert(auditLogs[0]?.action === 'CREATE', '5.7 Audit action is CREATE');

  // 5.4: Missing content should throw
  let threwError = false;
  try {
    await infra.intakeService.ingestMemory(
      {
        type: MemoryType.EPISODIC,
        content: '',  // EMPTY
        tenant_id: tenantId,
        user_id: userId,
        chatbot_channel_id: chatbotId,
      },
      'agent-1',
    );
  } catch (e) {
    threwError = true;
  }
  assert(threwError, '5.8 Empty content throws error');

  // 5.5: Type-specific defaults
  const semanticId = await infra.intakeService.ingestMemory(
    {
      type: MemoryType.PROCEDURAL,
      content: 'To reset a password: go to Settings > Security > Reset Password',
      tenant_id: tenantId,
      user_id: userId,
      chatbot_channel_id: chatbotId,
      metadata: { procedure_name: 'password_reset' },
    },
    'agent-1',
  );
  const procBlock = infra.mockPg.memoryBlocks.find((b: any) => b.memory_id === semanticId);
  assert(procBlock?.authority_level === AuthorityLevel.EXPERT, '5.9 Procedural memory gets EXPERT authority');
  assert(procBlock?.confidence === 0.7, '5.10 Procedural memory gets 0.7 initial confidence');
}

// ============================================================
// RUNNER
// ============================================================

async function runAllTests() {
  console.log('==========================================================');
  console.log('  GoChannel Memory System - Test Suite (Unified Architecture)');
  console.log('==========================================================');

  // Tests that don't need embeddings
  await testPromotionService();
  await testConflictResolver();
  await testSTM();
  await testSessionManagement();

  // Tests that need real embeddings
  await testMemoryIngestion();

  console.log('\n==========================================================');
  console.log('  RESULTS');
  console.log('==========================================================');
  for (const r of results) {
    console.log(r);
  }
  console.log('----------------------------------------------------------');
  console.log(`  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  if (failed === 0) {
    console.log('  ALL TESTS PASSED');
  } else {
    console.log(`  ${failed} TEST(S) FAILED`);
  }
  console.log('==========================================================');
}

runAllTests().catch((err) => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
