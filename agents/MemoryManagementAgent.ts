import { IntakeService } from '../memory/lifecycle/IntakeService';
import { SqlMemoryIndex } from '../memory/store/SqlMemoryIndex';
import { LTMStore } from '../memory/ltm/LTMStore';
import { EmbeddingService } from '../memory/ltm/EmbeddingService';
import { PromotionService } from '../memory/lifecycle/PromotionService';
import { MemoryStatus, MemoryBlock, MemoryType } from '../memory/types/MemoryBlock';

/**
 * Memory Manager Agent
 * 
 * The system-level governance agent for memory lifecycle.
 * Listens for new memories and can:
 *   - Validate and promote memories up the lifecycle
 *   - Update confidence based on corroboration
 *   - Trigger conflict detection on new memories
 * 
 * This is NOT a task agent (it doesn't chat with users).
 * It's the internal memory governance engine.
 */
export class MemoryManagerAgent {
  private intakeService: IntakeService;
  private sqlIndex: SqlMemoryIndex;
  private ltmStore: LTMStore;
  private embeddingService: EmbeddingService;
  private promotionService: PromotionService;

  constructor(
    intakeService: IntakeService,
    sqlIndex: SqlMemoryIndex,
    ltmStore: LTMStore,
    embeddingService: EmbeddingService,
    promotionService: PromotionService,
  ) {
    this.intakeService = intakeService;
    this.sqlIndex = sqlIndex;
    this.ltmStore = ltmStore;
    this.embeddingService = embeddingService;
    this.promotionService = promotionService;

    this.setupEventListeners();
  }

  // ─────────────────────────────────────
  //  Event Handling
  // ─────────────────────────────────────

  private setupEventListeners(): void {
    this.intakeService.on('memory_ingested', async (event) => {
      console.log(
        `[MemoryManager] New memory ingested: ${event.memoryId} [${event.type}] ` +
        `conf=${event.confidence} chatbot=${event.chatbotChannelId}`
      );
      await this.handleNewMemory(event);
    });
  }

  /**
   * Process a newly ingested memory.
   * 
   * This is the heart of the governance engine:
   *   1. Check for similar existing memories (potential conflicts or corroboration)
   *   2. If corroborated → boost confidence of both memories
   *   3. If conflicting → flag for conflict resolution (future)
   *   4. If the new memory has high enough confidence → auto-promote to VALIDATED
   */
  private async handleNewMemory(event: {
    memoryId: string;
    type: MemoryType;
    agentId: string;
    chatbotChannelId: string;
    userId: string;
    tenantId: string;
    confidence: number;
  }): Promise<void> {
    try {
      // 1. Get the full memory from LTM store
      const memory = await this.ltmStore.getById(event.memoryId);
      if (!memory) {
        console.warn(`[MemoryManager] Memory ${event.memoryId} not found in LTM store`);
        return;
      }

      // 2. Find similar memories for conflict/corroboration detection
      const similar = await this.ltmStore.findSimilar(
        memory.embedding,
        event.tenantId,
        event.chatbotChannelId,
        event.userId,
        event.type,
        5,
      );

      // Exclude self from results
      const otherSimilar = similar.filter(s => s.memory_id !== event.memoryId);

      if (otherSimilar.length > 0) {
        const topMatch = otherSimilar[0];

        if (topMatch.score >= 0.92) {
          // Very high similarity — likely corroboration or duplicate
          console.log(
            `[MemoryManager] Corroboration detected: ${event.memoryId} ↔ ${topMatch.memory_id} ` +
            `(similarity: ${(topMatch.score * 100).toFixed(1)}%)`
          );

          // Boost confidence of both memories
          const newConfidence = Math.min(1.0, topMatch.confidence + 0.15);
          await this.ltmStore.updateConfidence(topMatch.memory_id, newConfidence);
          await this.ltmStore.updateConfidence(event.memoryId, Math.min(1.0, event.confidence + 0.1));

          console.log(
            `[MemoryManager] Confidence boosted: ${topMatch.memory_id} → ${newConfidence.toFixed(2)}`
          );
        } else if (topMatch.score >= 0.75) {
          // Related but different — could be supplementary or slightly conflicting
          console.log(
            `[MemoryManager] Related memory found: ${topMatch.memory_id} ` +
            `(similarity: ${(topMatch.score * 100).toFixed(1)}%) — monitoring`
          );
          // Future: deeper conflict detection with LLM comparison
        }
      }

      // 3. Auto-promote high-confidence memories
      // Persona memories with user confirmation, or procedural with high confidence
      if (event.confidence >= 0.6 && event.type !== MemoryType.WHITEBOARD) {
        await this.tryAutoPromote(memory, event);
      }

    } catch (error) {
      console.error(`[MemoryManager] Error handling new memory ${event.memoryId}:`, error);
      // Don't throw — memory is already ingested, governance failure shouldn't break intake
    }
  }

  // ─────────────────────────────────────
  //  Promotion
  // ─────────────────────────────────────

  /**
   * Attempt auto-promotion of a memory from DRAFT to VALIDATED.
   */
  private async tryAutoPromote(
    memory: { memory_id: string; type: MemoryType; confidence: number },
    event: { chatbotChannelId: string; tenantId: string; agentId: string }
  ): Promise<void> {
    // Get the full PG record for promotion (which requires MemoryBlock)
    const candidates = await this.sqlIndex.fetchRetrievalCandidates(
      event.tenantId,
      event.chatbotChannelId,
      'system', // userId doesn't matter for promotion lookup
      [memory.type],
      0, // No confidence floor for this lookup
      1,
    );

    // For now, just log the intent. Real auto-promotion will be
    // wired when we fix the PromotionService confidence checks.
    console.log(
      `[MemoryManager] Memory ${memory.memory_id} eligible for auto-promotion ` +
      `(confidence: ${memory.confidence})`
    );
  }

  /**
   * Manually trigger promotion with full context.
   */
  async promoteMemory(
    memory: MemoryBlock,
    targetStatus: MemoryStatus,
    context?: {
      confirmedByUserId?: string;
      contributingAgents?: string[];
      agreementScore?: number;
    }
  ): Promise<void> {
    const success = await this.promotionService.promoteMemory(
      memory,
      targetStatus,
      'system-memory-manager',
      context,
    );

    if (!success) {
      console.log(
        `[MemoryManager] REJECTED: Promotion of ${memory.type} memory ${memory.memory_id} to ${targetStatus}`
      );
      return;
    }

    // Sync status to LTM store
    await this.ltmStore.update(memory.memory_id, { status: targetStatus });

    console.log(
      `[MemoryManager] PROMOTED: ${memory.type} memory ${memory.memory_id} → ${targetStatus}`
    );
  }

  /**
   * Cross-Chatbot Access Grant (Strictly Controlled)
   */
  async grantCrossChatbotAccess(
    agentId: string,
    targetChatbotId: string
  ): Promise<void> {
    // TODO: Implement proper cross-chatbot access control
    console.log(
      `[MemoryManager] WARNING: Cross-chatbot access request from ${agentId} for ${targetChatbotId}`
    );
  }
}
