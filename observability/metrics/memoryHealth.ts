
import client, { Counter, Gauge, Histogram } from 'prom-client';

/**
 * Memory Health Metrics
 * Observability layer for the memory engine.
 * Tracks system health, performance, and memory utilization.
 * UPDATED FOR SCHEMA 2.1
 */

// Initialize default registry
const register = client.register;

// 1. Memory Promotion Rate
export const memoryPromotionCounter = new Counter({
    name: 'memory_promotion_total',
    help: 'Total number of memory promotions by status',
    labelNames: ['target_status', 'agent_role', 'channel_domain_id'], // Added channel_domain_id
});

// 2. Conflict Rate
export const conflictRateCounter = new Counter({
    name: 'memory_conflict_total',
    help: 'Total number of memory conflicts detected and resolved',
    labelNames: ['resolution_type', 'channel_domain_id'], // Added channel_domain_id
});

// 3. Retrieval Cache Hit Rate
// Tracks efficiency of memory retrieval caching (Redis layer)
export const retrievalCacheHits = new Counter({
    name: 'memory_retrieval_cache_hits_total',
    help: 'Total number of cache hits for memory retrieval',
    labelNames: ['channel_domain_id']
});

export const retrievalCacheMisses = new Counter({
    name: 'memory_retrieval_cache_misses_total',
    help: 'Total number of cache misses for memory retrieval',
    labelNames: ['channel_domain_id']
});

// Computed as rate(hits) / (rate(hits) + rate(misses)) in Grafana

// 4. Token Usage per Workflow
export const tokenUsageHistogram = new Histogram({
    name: 'memory_token_usage_tokens',
    help: 'Distribution of token usage for memory context per workflow step',
    labelNames: ['workflow_type', 'agent_role', 'channel_domain_id'], // Added channel_domain_id
    buckets: [100, 500, 1000, 2000, 4000, 8000, 16000], // Token buckets
});

// 5. Consensus Reuse Rate
export const consensusReuseCounter = new Counter({
    name: 'memory_consensus_reuse_total',
    help: 'Number of times consensus memory blocks are retrieved/cited in new contexts',
    labelNames: ['memory_type', 'channel_domain_id'], // Added channel_domain_id
});

/**
 * Helper function to record a promotion event.
 */
export function recordPromotion(targetStatus: string, agentRole: string, channelDomainId: string) {
    memoryPromotionCounter.inc({ target_status: targetStatus, agent_role: agentRole, channel_domain_id: channelDomainId });
}

/**
 * Helper function to record a conflict resolution.
 */
export function recordConflict(resolutionType: string, channelDomainId: string) {
    conflictRateCounter.inc({ resolution_type: resolutionType, channel_domain_id: channelDomainId });
}

/**
 * Helper function to record token usage.
 */
export function recordTokenUsage(tokens: number, workflowType: string, agentRole: string, channelDomainId: string) {
    tokenUsageHistogram.observe({ workflow_type: workflowType, agent_role: agentRole, channel_domain_id: channelDomainId }, tokens);
}

/**
 * Expose metrics endpoint handler (e.g., for Express)
 */
export async function getMetrics(): Promise<string> {
    return await register.metrics();
}
