
import client, { Gauge, Counter, Histogram } from 'prom-client';

/**
 * Chatbot Memory Health Metrics (Prompt 27)
 * Observability metrics partitioned by chatbot_channel_id.
 * Tracks usage, growth, and isolation violations.
 * 
 * Replaces domainMemoryHealth.ts
 */

const register = client.register;

// 1. STM Size per Session
export const stmSizeGauge = new Gauge({
    name: 'memory_stm_size_bytes',
    help: 'Estimated size of STM state per session in bytes',
    labelNames: ['chatbot_channel_id', 'user_channel_session_id']
});

// 2. LTM Growth per Chatbot
export const ltmGrowthCounter = new Counter({
    name: 'memory_ltm_blocks_created_total',
    help: 'Total number of LTM blocks created per chatbot',
    labelNames: ['chatbot_channel_id', 'memory_type']
});

// 3. Cross-Chatbot Access Attempts (Violation)
export const crossChatbotAccessCounter = new Counter({
    name: 'memory_cross_chatbot_access_attempts_total',
    help: 'Number of attempted cross-chatbot memory accesses (forbidden)',
    labelNames: ['source_chatbot_id', 'target_chatbot_id', 'agent_role']
});

// 4. Token Usage per Chatbot
export const chatbotTokenUsageHistogram = new Histogram({
    name: 'memory_chatbot_token_usage_tokens',
    help: 'Token usage distribution per chatbot',
    labelNames: ['chatbot_channel_id', 'workflow_step'],
    buckets: [100, 500, 1000, 2000, 4000, 8000, 16000]
});

// 5. Workflow Success Rate per Chatbot
export const workflowOutcomeCounter = new Counter({
    name: 'workflow_outcome_total',
    help: 'Workflow execution outcomes per chatbot',
    labelNames: ['chatbot_channel_id', 'outcome']
});

export function recordStmSize(chatbotId: string, sessionId: string, sizeBytes: number) {
    stmSizeGauge.set({ chatbot_channel_id: chatbotId, user_channel_session_id: sessionId }, sizeBytes);
}

export function recordLtmCreation(chatbotId: string, type: string) {
    ltmGrowthCounter.inc({ chatbot_channel_id: chatbotId, memory_type: type });
}

export function recordCrossChatbotAccess(sourceId: string, targetId: string, agentRole: string) {
    crossChatbotAccessCounter.inc({ source_chatbot_id: sourceId, target_chatbot_id: targetId, agent_role: agentRole });
}

export function recordWorkflowOutcome(chatbotId: string, success: boolean) {
    const outcome = success ? 'success' : 'failure';
    workflowOutcomeCounter.inc({ chatbot_channel_id: chatbotId, outcome });
}
