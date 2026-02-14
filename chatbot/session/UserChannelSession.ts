
import { randomUUID } from 'crypto';

export enum SessionStatus {
    ACTIVE = 'active',
    CLOSED = 'closed',
    EXPIRED = 'expired',
}

/**
 * User Channel Session (Execution Root)
 * The PRIMARY execution identity for all interactions.
 * - Globally unique
 * - Scope for STM, Chat History, and Workflow Execution.
 * - Bound to ONE user and ONE chatbot channel.
 * 
 * UPDATED PROMPT 16 (Chatbot-Centric)
 */
export class UserChannelSession {
    readonly userChannelSessionId: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly chatbotChannelId: string; // The deployed chatbot instance

    public status: SessionStatus;
    readonly startedAt: Date;
    public endedAt?: Date;
    public lastActivityAt: Date;

    constructor(
        tenantId: string,
        userId: string,
        chatbotChannelId: string
    ) {
        this.userChannelSessionId = randomUUID();
        this.tenantId = tenantId;
        this.userId = userId;
        this.chatbotChannelId = chatbotChannelId;

        this.status = SessionStatus.ACTIVE;
        this.startedAt = new Date();
        this.lastActivityAt = new Date();
    }

    /**
     * Factory method to start a new session.
     */
    static createUserChannelSession(
        tenantId: string,
        userId: string,
        chatbotChannelId: string
    ): UserChannelSession {
        if (!tenantId || !userId || !chatbotChannelId) {
            throw new Error('Cannot create session: Missing required context (tenant, user, channel)');
        }
        return new UserChannelSession(tenantId, userId, chatbotChannelId);
    }

    /**
     * Close the session securely.
     */
    closeSession(): void {
        if (this.status !== SessionStatus.ACTIVE) return;
        this.status = SessionStatus.CLOSED;
        this.endedAt = new Date();
    }

    /**
     * Maintain active status.
     */
    touch(): void {
        if (this.status === SessionStatus.ACTIVE) {
            this.lastActivityAt = new Date();
        }
    }

    isActive(): boolean {
        return this.status === SessionStatus.ACTIVE;
    }
}
