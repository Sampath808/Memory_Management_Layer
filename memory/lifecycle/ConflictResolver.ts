
import { SqlMemoryIndex } from '../store/SqlMemoryIndex';
import { MemoryBlock, MemoryStatus, AuthorityLevel } from '../types/MemoryBlock';

export enum ConflictResult {
    RESOLVED_A_WINS = 'resolved_a_wins',
    RESOLVED_B_WINS = 'resolved_b_wins',
    UNRESOLVED = 'unresolved',
    NO_CONFLICT = 'no_conflict',
}

/**
 * Memory Conflict Resolver (Chatbot-Centric)
 * Resolves contradictions within a chatbot's knowledge base.
 */
export class ConflictResolver {
    private sqlIndex: SqlMemoryIndex;

    constructor(sqlIndex: SqlMemoryIndex) {
        this.sqlIndex = sqlIndex;
    }

    async resolve(existing: MemoryBlock, challenger: MemoryBlock): Promise<ConflictResult> {

        // 1. Consensus Supremacy
        if (existing.status === MemoryStatus.CONSENSUS && challenger.status !== MemoryStatus.CONSENSUS) {
            if (challenger.authority_level !== AuthorityLevel.SYSTEM) {
                await this.logResolution(existing, challenger, 'Existing Consensus Overrules');
                return ConflictResult.RESOLVED_A_WINS;
            }
        }

        if (challenger.status === MemoryStatus.CONSENSUS && existing.status !== MemoryStatus.CONSENSUS) {
            await this.logResolution(challenger, existing, 'New Consensus Overrules');
            return ConflictResult.RESOLVED_B_WINS;
        }

        // 2. Authority Levels
        const authorityScore = {
            [AuthorityLevel.SYSTEM]: 4,
            [AuthorityLevel.EXPERT]: 3,
            [AuthorityLevel.STANDARD]: 2,
            [AuthorityLevel.GUEST]: 1,
        };

        if (authorityScore[existing.authority_level] > authorityScore[challenger.authority_level]) {
            return ConflictResult.RESOLVED_A_WINS;
        }

        if (authorityScore[challenger.authority_level] > authorityScore[existing.authority_level]) {
            return ConflictResult.RESOLVED_B_WINS;
        }

        // 3. Confidence Scores
        const significantDiff = 0.2;
        if (existing.confidence > challenger.confidence + significantDiff) {
            return ConflictResult.RESOLVED_A_WINS;
        }

        if (challenger.confidence > existing.confidence + significantDiff) {
            return ConflictResult.RESOLVED_B_WINS;
        }

        return ConflictResult.UNRESOLVED;
    }

    private async logResolution(winner: MemoryBlock, loser: MemoryBlock, reason: string): Promise<void> {
        await this.sqlIndex.recordAuditEvent({
            memory_id: winner.memory_id,
            user_channel_session_id: winner.originating_session_id,
            action: 'CONFLICT_WIN',
            actor_agent_id: 'system-conflict-resolver',
            chatbot_channel_id: winner.chatbot_channel_id, // Updated Audit Context
            notes: `Defeated memory ${loser.memory_id}. Reason: ${reason}`
        });
    }
}
