# GoChannel

You are working in a production-grade multi-agent AI platform called GoChannel.

## Core principles
- Memory is infrastructure, not agent side-effects
- Multi-agent systems fail due to memory breakdown, not communication
- All memory is versioned, governed, and agent-aware
- Task agents cannot promote or delete memory
- A system agent called MemoryManagerAgent governs memory lifecycle

## Canonical Scoping Rules (LOCKED)
These rules are enforced at the schema level.

| Layer | Primary Scope |
|-------|---------------|
| Chat history | userChannelSessionID |
| STM | userChannelSessionID |
| Workflow execution | userChannelSessionID |
| Agent runs | userChannelSessionID |
| Episodic LTM | channelDomainID |
| Semantic LTM | channelDomainID (or GLOBAL) |
| Procedural LTM | channelDomainID |
| Global preferences | userID |

❗ **channelDomainID is mandatory everywhere except explicit global memory**

## Tech stack
- Node.js + TypeScript
- PostgreSQL (authoritative memory index)
- MongoDB (memory payloads)
- Redis (cache / KV)
- Vector DB (semantic memory)
- LangGraph-compatible orchestration

## Never
- Pass raw agent outputs directly to other agents
- Allow agents to bypass memory services
- Mix memory types together

## Always
- Enforce tenant, workflow, and agent boundaries
- Design for auditability and rollback
