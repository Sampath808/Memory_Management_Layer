# GoChannel Memory Layer — Gaps & Missing Features

> **Last Updated:** 2026-02-13
> **Status:** Analysis complete, no fixes applied yet
> **Test Suite:** 48/48 passing (with mocks)

---

## Table of Contents

1. [Dead Code & Evolutionary Leftovers](#1-dead-code--evolutionary-leftovers)
2. [Confidence Score System — No Writer](#2-confidence-score-system--no-writer)
3. [Authority Level — No Dynamic Assignment](#3-authority-level--no-dynamic-assignment)
4. [Conflict Detection — Nonexistent](#4-conflict-detection--nonexistent)
5. [Conflict Resolution — Disconnected](#5-conflict-resolution--disconnected)
6. [Retrieval Architecture — Split Brain](#6-retrieval-architecture--split-brain)
7. [Agent Layer — Unused Scaffolding](#7-agent-layer--unused-scaffolding)
8. [Mock / Placeholder Implementations](#8-mock--placeholder-implementations)
9. [Stale References & Documentation](#9-stale-references--documentation)
10. [Missing Integrations](#10-missing-integrations)
11. [Summary Table](#11-summary-table)

---

## 1. Dead Code & Evolutionary Leftovers

The project evolved from a **generic multi-agent platform** to a **chatbot-centric memory system** through a series of iterative prompts (visible in code comments as "Prompt 10", "Prompt 24", "Prompt 26", etc.). Earlier components were never removed.

### 1.1 `RetrievalEngine` (Dead)

- **File:** `retrieval/RetrievalEngine.ts`
- **What it does:** SQL-only memory retrieval with authority filtering and summarization
- **Why it's dead:** Never instantiated in `container.ts`. `ChatbotMemoryAssembler` replaced it as the actual retrieval path. Nobody constructs a `RetrievalEngine` anywhere in the running system.
- **Used by:** `BaseAgent.receiveContext()` — which is also dead (see §7)
- **Action:** Remove or merge functionality into `ChatbotMemoryAssembler`

### 1.2 `WorkflowExecutor` (Dead)

- **File:** `workflows/engine/WorkflowExecutor.ts`
- **What it does:** Generic sequential agent workflow execution (tenant + project scoping only)
- **Why it's dead:** `ChatbotWorkflowExecutor` is the chatbot-centric replacement with proper `chatbotChannelId` + `userChannelSessionId` scoping. The generic one has no chatbot binding.
- **Action:** Remove — `ChatbotWorkflowExecutor` is the canonical version

### 1.3 Memory Type Factory Classes (Unused)

- **Files:**
  - `memory/ltm/episodic/EpisodicMemory.ts`
  - `memory/ltm/semantic/SemanticMemory.ts`
  - `memory/ltm/procedural/ProceduralMemory.ts`
  - `memory/ltm/persona/PersonaMemory.ts`
  - `memory/ltm/consensus/ConsensusMemory.ts`
- **What they do:** Static `create()` methods that build properly typed `MemoryBlock` objects with appropriate authority levels and TTL policies
- **Why they're unused:** All real memory creation goes through `IntakeService.ingestMemory()`, which builds its own `MemoryBlock` from scratch. These factory classes are never called by any service, agent, or route.
- **Consequence:** The carefully designed per-type authority levels (e.g., `ProceduralMemory → EXPERT`, `ConsensusMemory → SYSTEM`) are never applied.
- **Action:** Either integrate these factories into `IntakeService` or remove them

---

## 2. Confidence Score System — No Writer

### The Problem

Confidence is used as a **critical gate** throughout the system, but nothing ever increases it after creation.

### Where Confidence Is Set

| Entry Point | Value | Notes |
|---|---|---|
| `IntakeService.ingestMemory()` | `0.1` | Hardcoded — all real memories start here |
| `EpisodicMemory.create()` | `1.0` | Factory class, never called |
| `SemanticMemory.create()` | `0.9` | Factory class, never called |
| `ProceduralMemory.create()` | `1.0` | Factory class, never called |
| `PersonaMemory.create()` | `1.0` | Factory class, never called |
| `ConsensusMemory.create()` | `agreement_score` | Factory class, never called |

### Where Confidence Is Consumed

| Consumer | Threshold | Effect |
|---|---|---|
| `PromotionService` | `< 0.4` → blocked | Memories at 0.1 can never be promoted to VALIDATED |
| `SqlMemoryIndex.fetchRetrievalCandidates()` | `>= 0.6` | Memories at 0.1 are invisible to LTM retrieval |
| `SemanticLTMStore.searchSemanticMemory()` | `>= 0.7` | Memories at 0.1 are invisible to vector search |
| `ConflictResolver` | Diff `> 0.2` | Used as tiebreaker (irrelevant since all are 0.1) |
| `RetrievalEngine` | `>= 0.4` or `>= 0.8` | Role-dependent threshold (dead code anyway) |

### The Dead Loop

```
Memory created → confidence = 0.1
                      ↓
Promotion gate (0.4) → BLOCKED
                      ↓
Retrieval gate (0.6) → INVISIBLE
                      ↓
Semantic search gate (0.7) → INVISIBLE
                      ↓
Memory exists in DB but can never be used
```

### What's Missing

A confidence scoring engine that increases confidence based on:
- **Corroboration** — other agents produce agreeing memories
- **User confirmation** — explicit user validation
- **Usage frequency** — memory that keeps being retrieved and useful
- **Age + stability** — memory that hasn't been contradicted over time
- **Source quality** — memories from more reliable agents/sources

There is no `updateConfidence()` method, no scheduled confidence recalculation, and no event-driven confidence update.

---

## 3. Authority Level — No Dynamic Assignment

### The Problem

Authority determines winner in conflict resolution and filters retrieval access, but it's always `STANDARD`.

### How Authority Is Actually Assigned

`IntakeService.ingestMemory()` hardcodes `authority_level: AuthorityLevel.STANDARD` (line 66). There is:
- No parameter in `ProposedMemory` interface to specify authority
- No lookup of the creating agent's trust level
- No way to override authority at ingestion time
- No mechanism to escalate authority after creation

### Design Intent vs. Reality

| Memory Type | Intended Authority | Actual Authority |
|---|---|---|
| Episodic | STANDARD | STANDARD (via IntakeService) |
| Semantic | STANDARD | STANDARD (via IntakeService) |
| Procedural | EXPERT | STANDARD (via IntakeService) |
| Consensus | SYSTEM | STANDARD (via IntakeService) |
| Persona | STANDARD | STANDARD (via IntakeService) |

The factory classes define the *intended* authority, but since they're never used, everything gets `STANDARD`.

### Consequence

- `ConflictResolver` Rule 2 (authority comparison) can never produce a winner — all memories have the same level
- `RetrievalEngine`'s guest filtering (`authority_level !== SYSTEM`) is meaningless — nothing is `SYSTEM`
- The 4-level authority hierarchy (`SYSTEM > EXPERT > STANDARD > GUEST`) is entirely theoretical

### What's Missing

An authority assignment mechanism that considers:
- Which agent created the memory (system agent → `SYSTEM`, domain expert → `EXPERT`)
- Whether the memory was user-confirmed (→ escalate to `EXPERT`)
- The memory type (procedural knowledge should be `EXPERT` by default)

---

## 4. Conflict Detection — Nonexistent

### The Problem

The system has a `ConflictResolver` but **no conflict detection**. Nothing identifies when two memories contradict each other.

### Detection Points That Don't Exist

| Possible Trigger | Status |
|---|---|
| On ingestion — check if new memory contradicts existing ones | ❌ Not implemented |
| On promotion — check conflicts before promoting | ❌ Not implemented |
| On retrieval — detect contradictions in results | ❌ Not implemented |
| Scheduled scan — periodic contradiction sweep | ❌ Not implemented |
| Semantic similarity — find memories about same topic with different conclusions | ❌ Not implemented |

### What's Needed

A detection pipeline that:
1. When a new memory is ingested, searches for existing memories with similar content/topic in the same chatbot scope
2. Uses semantic similarity (embeddings) to find topically related memories
3. Determines if the new memory *contradicts* (vs. merely *relates to*) existing ones
4. Automatically calls `ConflictResolver.resolve()` when contradictions are found
5. Acts on the result (deprecates the loser)

---

## 5. Conflict Resolution — Disconnected

### The Problem

`ConflictResolver` has correct resolution logic (tested 4/4 ✅) but is completely disconnected from the system.

### Disconnection Points

| Integration | Status |
|---|---|
| Instantiated in `container.ts`? | ❌ Imported but never constructed |
| Called by `IntakeService`? | ❌ No |
| Called by `PromotionService`? | ❌ No |
| Called by `MemoryManagerAgent`? | ❌ No |
| Called by any route handler? | ❌ No |
| Called by any workflow step? | ❌ No |

### Result Not Acted Upon

Even when called manually, `resolve()` returns an enum (`RESOLVED_A_WINS`, etc.) but:
- Does **not** deprecate the losing memory
- Does **not** update the winning memory's confidence
- Only logs audit events for consensus-level resolutions (authority and confidence resolutions are silent)

### What's Missing

- Wire `ConflictResolver` into `IntakeService` or `MemoryManagerAgent`
- Add a `deprecateLoser()` step after resolution
- Log all resolution outcomes, not just consensus ones
- Support multi-way conflicts (current: pairwise only)

---

## 6. Retrieval Architecture — Split Brain

### The Problem

Two independent retrieval systems exist, built at different design phases, serving overlapping purposes.

### The Two Paths

| Component | Built | Features | Used By |
|---|---|---|---|
| `RetrievalEngine` | Early phase | SQL only, authority filter, summarization | `BaseAgent` (dead) |
| `ChatbotMemoryAssembler` | Later phase | STM + Vector Search (RAG) + SQL fallback | API routes (active) |

### Consequences

- **Agents in workflows** (via `BaseAgent.receiveContext()`) would get SQL-only retrieval — no STM, no RAG
- **API consumers** get the full pipeline — STM → RAG → SQL
- Two different token budgeting strategies
- Two different summarization approaches

### Additional Retrieval Gaps

| Issue | Detail |
|---|---|
| No caching | Every call hits Redis + MongoDB/PG fresh |
| Sequential summarization | LTM candidates are summarized one-at-a-time in a `for` loop |
| Fixed token estimates | Token costs are hardcoded (150, 200, 100, 50), not actual counts |
| No re-ranking | SQL path uses `ORDER BY strength` but doesn't re-rank after summarization |
| STM and SQL are mutually exclusive | If `queryText` is provided, SQL LTM (episodic/procedural) is completely skipped |
| RAG only covers semantic | Vector search doesn't index episodic, procedural, or consensus memories |

### What's Missing

- Consolidate into one retrieval path
- Add result caching (short TTL)
- Parallelize summarization with `Promise.all()`
- Implement real token counting (e.g., `tiktoken`)
- Make retrieval truly hybrid: always include STM + RAG + SQL

---

## 7. Agent Layer — Unused Scaffolding

### 7.1 `BaseAgent` — No Subclasses

- **File:** `agents/base/BaseAgent.ts`
- **Purpose:** Abstract contract requiring `chatbotChannelId` + `userChannelSessionId`, providing `receiveContext()` and `writeMemory()` methods
- **Problem:** Zero classes extend it. No `ChatAgent`, `ResearchAgent`, `MathAgent`, etc.
- **Note:** `MemoryManagerAgent` does **NOT** extend `BaseAgent` — it's a standalone class

### 7.2 `MemoryManagerAgent` — Partially Integrated

- **File:** `agents/system/MemoryManagerAgent/index.ts`
- **What works:**
  - ✅ Listens to `memory_ingested` events from `IntakeService`
  - ✅ `promoteMemory()` correctly updates SQL status and generates semantic embeddings
  - ✅ Handles consensus and persona LTM stores
- **What's missing:**
  - ❌ `handleNewMemory()` is a stub — just logs, does nothing
  - ❌ No automatic validation/promotion pipeline
  - ❌ No conflict detection on new memories
  - ❌ `grantCrossChatbotAccess()` is a stub

### 7.3 No Task Agents Exist

The system is a **memory infrastructure** layer. There are no agents that actually *use* the memory system to perform tasks (chatbot conversation, document analysis, etc.). The entire agent + workflow layer is scaffolding for future development.

---

## 8. Mock / Placeholder Implementations

### 8.1 Embedding Generation

- **Location:** `ChatbotMemoryAssembler.generateEmbedding()` and `MemoryManagerAgent.generateEmbedding()`
- **Current:** Returns `new Array(1536).fill(0.1)` — a flat vector with no semantic meaning
- **Impact:** Vector search cannot distinguish between any two queries — all embeddings are identical
- **Fix:** Integrate OpenAI `text-embedding-3-small` or a local embedding model

### 8.2 Hierarchical Summarizer

- **Location:** `memory/summarization/HierarchicalSummarizer.ts`
- **Current:** `mockLLMZSummarization()` truncates text by character count
- **Impact:** Summaries are naive substrings, not intelligent condensations
- **Fix:** Integrate an LLM with the commented-out `buildSummarizationPrompt()`

### 8.3 WhiteboardService

- **Location:** `memory/stm/WhiteboardService.ts`
- **Current:** Fully implemented (Redis-backed ephemeral scratchpad for multi-agent collaboration)
- **Problem:** Built but never integrated into any retrieval path or workflow
- **Fix:** Add whiteboard context to `ChatbotMemoryAssembler.assembleContext()`

---

## 9. Stale References & Documentation

### 9.1 README.md

- Still references `channelDomainID` in the scoping table
- Code uses `chatbot_channel_id` everywhere with comments saying `// channelDomainId REMOVED`
- Should be updated to reflect current naming

### 9.2 `memoryHealth.ts` Metrics

- **File:** `observability/metrics/memoryHealth.ts`
- Still uses `channel_domain_id` as a Prometheus label
- Functions `recordPromotion()`, `recordConflict()`, `recordTokenUsage()` accept `channelDomainId` parameter
- Should be updated to `chatbot_channel_id`

### 9.3 `BaseAgent.ts` Comments

- Lines 65-80 contain a 15-line internal debate about whether to use `RetrievalEngine` or `ChatbotMemoryAssembler`
- These design notes should be resolved and removed

---

## 10. Missing Integrations

| Component | Exists | Integrated | Notes |
|---|---|---|---|
| `DecayService` | ✅ | ❌ | Has `applyDecay()` logic but no scheduler/cron calls it |
| `WhiteboardService` | ✅ | ❌ | Built but not in any retrieval path |
| `ConflictResolver` | ✅ | ❌ | Imported in container but never instantiated |
| `ChatHistoryStore` | ✅ | ❌ | Built but not used by retrieval or summarization |
| `SqlChatbotRegistry` | ✅ | ✅ | Used by admin routes |
| Prometheus Metrics | ✅ | ❌ | Defined but never called (no `recordPromotion()`, `recordConflict()` calls in code) |

---

## 11. Summary Table

| # | Gap | Severity | Category |
|---|---|---|---|
| 1 | Confidence never increases from 0.1 — blocks promotion and retrieval | 🔴 Critical | Logic |
| 2 | Authority always STANDARD — conflict resolution rule is useless | 🔴 Critical | Logic |
| 3 | No conflict detection — ConflictResolver exists but is never triggered | 🔴 Critical | Missing Feature |
| 4 | ConflictResolver not wired into system — resolution results are ignored | 🟠 High | Integration |
| 5 | No task agents — BaseAgent has no subclasses | 🟠 High | Missing Feature |
| 6 | Two retrieval engines — agents get worse context than API consumers | 🟠 High | Architecture |
| 7 | Embedding is fake — vector search returns random results | 🟠 High | Placeholder |
| 8 | Summarizer uses substring truncation, not LLM | 🟡 Medium | Placeholder |
| 9 | DecayService has no scheduler | 🟡 Medium | Integration |
| 10 | WhiteboardService not in retrieval pipeline | 🟡 Medium | Integration |
| 11 | Prometheus metrics defined but never recorded | 🟡 Medium | Integration |
| 12 | Memory type factories not used by IntakeService | 🟡 Medium | Dead Code |
| 13 | WorkflowExecutor (generic) is superseded by ChatbotWorkflowExecutor | 🟢 Low | Dead Code |
| 14 | RetrievalEngine is dead code | 🟢 Low | Dead Code |
| 15 | README and metrics use stale `channelDomainId` naming | 🟢 Low | Documentation |
| 16 | BaseAgent has 15-line internal design debate in comments | 🟢 Low | Code Quality |
| 17 | MemoryManagerAgent.handleNewMemory() is a stub | 🟡 Medium | Incomplete |
| 18 | ChatHistoryStore built but unused in retrieval | 🟡 Medium | Integration |

---

## Recommended Fix Priority

### Phase 1 — Unblock the Core Loop (Critical)
1. Add confidence scoring engine (corroboration, user confirmation, source quality)
2. Wire authority level assignment based on agent role and memory type
3. Make IntakeService use memory type factories (or accept authority as parameter)

### Phase 2 — Connect Disconnected Systems (High)
4. Build conflict detection in IntakeService (semantic similarity check on ingest)
5. Wire ConflictResolver into the system + deprecate losers
6. Consolidate the two retrieval paths into ChatbotMemoryAssembler

### Phase 3 — Replace Placeholders (Medium)
7. Integrate real embedding model (OpenAI or local)
8. Integrate real LLM for HierarchicalSummarizer
9. Add DecayService scheduler (cron or setInterval)
10. Add WhiteboardService to retrieval pipeline

### Phase 4 — Cleanup (Low)
11. Remove dead code (RetrievalEngine, WorkflowExecutor)
12. Update README and metrics to use chatbot_channel_id
13. Clean up BaseAgent comments
14. Build at least one concrete task agent extending BaseAgent
