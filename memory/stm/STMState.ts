
/**
 * Short-Term Memory (STM) State
 * Represents the transient state of a user's session within a specific chatbot channel.
 * - Rewritten, never appended
 * - Expires on session close
 * 
 * UPDATED PROMPT 18 (Chatbot-Centric)
 */
export interface STMState {
    // Identity & Scope
    userChannelSessionId: string;
    chatbotChannelId: string;
    // channelDomainId REMOVED

    // Workflow Context
    workflow_id?: string;

    // Cognitive State
    active_intent?: string;
    focus_entity_ids: string[];
    pending_actions: string[];

    // High-level summary of current train of thought
    summarized_state: string;

    last_updated_at: Date;
}
