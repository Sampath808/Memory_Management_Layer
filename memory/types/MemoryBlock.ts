
/**
 * GoChannel Memory Engine — Core Type Definitions
 * 
 * This is the canonical memory definition for the entire platform.
 * External AI agents interact with these types via the API.
 * 
 * Design principle: The calling agent decides the memory type.
 * The memory layer applies smart defaults and governs the lifecycle.
 */

// ─────────────────────────────────────────────
//  ENUMS
// ─────────────────────────────────────────────

/**
 * Memory Types — The fundamental nature of the memory.
 * The external AI agent specifies this when storing a memory.
 */
export enum MemoryType {
  EPISODIC = 'episodic',       // Specific events, interactions, or outcomes
  PROCEDURAL = 'procedural',   // How-to knowledge, skills, and routines
  CONSENSUS = 'consensus',     // Validated facts agreed upon by multiple agents
  SEMANTIC = 'semantic',       // General knowledge, definitions, facts, preferences
  PERSONA = 'persona',         // User personality traits and behavioral patterns
  WHITEBOARD = 'whiteboard',   // Temporary scratchpad / working memory
}

/**
 * Memory Status — Lifecycle state of a memory.
 * Managed by the memory layer, not by external agents.
 */
export enum MemoryStatus {
  DRAFT = 'draft',             // Initial creation (unverified)
  VALIDATED = 'validated',     // Passed confidence/quality checks
  CONSENSUS = 'consensus',     // Promoted to systemic truth (multi-agent agreement)
  DEPRECATED = 'deprecated',   // Superseded or contradicted
}

/**
 * Authority Level — Trust ranking of the memory source.
 * Set automatically based on memory type + source, can be escalated.
 */
export enum AuthorityLevel {
  SYSTEM = 'system',           // Highest: system agent, admin
  EXPERT = 'expert',           // Specialized agents, user-confirmed data
  STANDARD = 'standard',       // Regular task agents
  GUEST = 'guest',             // External/unverified inputs
}

/**
 * TTL Policy — Retention duration for the memory.
 */
export enum TTLPolicy {
  SESSION = 'session',         // Dies with the session
  CHATBOT = 'chatbot',         // Persists within the chatbot channel (standard LTM)
  PERSISTENT = 'persistent',   // Never decays (global preferences, core rules)
}

// ─────────────────────────────────────────────
//  MEMORY BLOCK (PG Index Row)
// ─────────────────────────────────────────────

/**
 * MemoryBlock — The metadata record stored in PostgreSQL.
 * This is the lightweight governance index. The actual content
 * and embedding live in MongoDB (LTMStore).
 */
export interface MemoryBlock {
  // Identity (Immutable)
  readonly memory_id: string;

  // Core Classification
  type: MemoryType;
  status: MemoryStatus;

  // Scoping & Isolation
  tenant_id: string;
  user_id: string;
  chatbot_channel_id: string;       // Primary partition key
  originating_session_id?: string;

  // Ownership & Authority
  owner_agent_id?: string;
  authority_level: AuthorityLevel;

  // Metrics
  confidence: number;               // 0-1, increases via corroboration/confirmation
  strength: number;                 // 0-1, decays over time unless reinforced

  // Versioning & Lineage
  version: number;
  parent_memory_id?: string;

  // Content Reference — points to the LTMStore document
  content_type: 'mongo';
  content_ref?: string;             // memory_id in the `memories` collection

  summary?: string;
  ttl_policy: TTLPolicy;

  // Timestamps
  created_at: Date;
  updated_at: Date;
  last_accessed_at?: Date;
}

// ─────────────────────────────────────────────
//  TYPE-SPECIFIC METADATA INTERFACES
// ─────────────────────────────────────────────

/**
 * These interfaces define what can go in the `metadata` field
 * of an LTMDocument, depending on the memory type.
 * They are NOT enforced at the DB level — they're type hints
 * for agents and application code.
 */

export interface EpisodicMetadata {
  entities?: string[];
  outcome?: string;
  event_timestamp?: Date;
}

export interface SemanticMetadata {
  scope?: 'chatbot' | 'global';
  tags?: string[];
  subject?: string;
  predicate?: string;
  object?: string;
}

export interface ProceduralMetadata {
  procedure_name?: string;
  steps?: string[];
  success_rate?: number;
}

export interface PersonaMetadata {
  trait_key?: string;
  trait_value?: string;
  category?: string;       // e.g. 'communication_style', 'preferences'
}

export interface ConsensusMetadata {
  topic?: string;
  contributing_agents?: string[];
  agreement_score?: number;
}
