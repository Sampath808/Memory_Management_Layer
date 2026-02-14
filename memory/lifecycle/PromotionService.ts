
import { SqlMemoryIndex } from '../store/SqlMemoryIndex';
import { MemoryBlock, MemoryStatus, AuthorityLevel, MemoryType } from '../types/MemoryBlock';

/**
 * Memory Promotion Service (Chatbot-Centric)
 * Enforces rules for moving memory up the chain.
 * Chatbot Channel is the boundary.
 */
export class PromotionService {
    private sqlIndex: SqlMemoryIndex;

    constructor(sqlIndex: SqlMemoryIndex) {
        this.sqlIndex = sqlIndex;
    }

    async promoteMemory(
        memory: MemoryBlock,
        targetStatus: MemoryStatus,
        promoterAgentId: string,
        context?: { confirmedByUserId?: string, contributingAgents?: string[], agreementScore?: number }
    ): Promise<boolean> {

        if (!this.isValidTransition(memory.status, targetStatus)) {
            await this.recordFailure(memory, promoterAgentId, `Invalid status transition: ${memory.status} -> ${targetStatus}`);
            return false;
        }

        // Rule Enforcements
        if (memory.type === MemoryType.WHITEBOARD) {
            await this.recordFailure(memory, promoterAgentId, "Whiteboard memory is ephemeral and cannot be promoted.");
            return false;
        }

        if (memory.type === MemoryType.PERSONA) {
            if (!context?.confirmedByUserId) {
                await this.recordFailure(memory, promoterAgentId, "Persona memory requires explicit user confirmation.");
                return false;
            }
        }

        if (memory.type === MemoryType.CONSENSUS) {
            if (!context?.contributingAgents || context.contributingAgents.length < 2) {
                await this.recordFailure(memory, promoterAgentId, "Consensus memory requires at least 2 contributing agents.");
                return false;
            }
            if (context.agreementScore === undefined || context.agreementScore < 0.7) {
                await this.recordFailure(memory, promoterAgentId, `Consensus memory requires agreement score >= 0.7. Current: ${context.agreementScore}`);
                return false;
            }
        }

        if (targetStatus === MemoryStatus.CONSENSUS) {
            if (memory.authority_level !== AuthorityLevel.SYSTEM && memory.authority_level !== AuthorityLevel.EXPERT) {
                // Warning or rejection based on authority
            }
        }

        if (targetStatus === MemoryStatus.VALIDATED && memory.confidence < 0.4) {
            await this.recordFailure(memory, promoterAgentId, `Insufficient confidence score: ${memory.confidence}`);
            return false;
        }

        try {
            await this.sqlIndex.updateMemoryStatus(
                memory.memory_id,
                targetStatus,
                promoterAgentId,
                memory.chatbot_channel_id // Mandatory Audit Context
            );

            await this.sqlIndex.recordAuditEvent({
                memory_id: memory.memory_id,
                user_channel_session_id: memory.originating_session_id,
                action: 'PROMOTION_SUCCESS',
                actor_agent_id: promoterAgentId,
                chatbot_channel_id: memory.chatbot_channel_id,
                notes: `Promoted from ${memory.status} to ${targetStatus}`
            });

            return true;

        } catch (error) {
            console.error('Promotion failed:', error);
            return false;
        }
    }

    private async recordFailure(memory: MemoryBlock, actorId: string, notes: string) {
        await this.sqlIndex.recordAuditEvent({
            memory_id: memory.memory_id,
            user_channel_session_id: memory.originating_session_id,
            action: 'PROMOTION_FAILED',
            actor_agent_id: actorId,
            chatbot_channel_id: memory.chatbot_channel_id,
            notes: notes
        });
    }

    private isValidTransition(current: MemoryStatus, target: MemoryStatus): boolean {
        const validTransitions: Record<MemoryStatus, MemoryStatus[]> = {
            [MemoryStatus.DRAFT]: [MemoryStatus.VALIDATED, MemoryStatus.DEPRECATED],
            [MemoryStatus.VALIDATED]: [MemoryStatus.CONSENSUS, MemoryStatus.DEPRECATED],
            [MemoryStatus.CONSENSUS]: [MemoryStatus.DEPRECATED],
            [MemoryStatus.DEPRECATED]: []
        };

        return validTransitions[current]?.includes(target) || false;
    }
}
