
import { Router, Request, Response } from 'express';
import { container } from '../container';
import { MemoryType, TTLPolicy } from '../../memory/types/MemoryBlock';
import { ProposedMemory } from '../../memory/lifecycle/IntakeService';

const router = Router();

/**
 * POST /api/v1/memory/ingest
 * 
 * Store a new memory. The calling agent decides the type.
 * 
 * Body:
 *   type: 'episodic' | 'semantic' | 'procedural' | 'persona' | 'consensus'
 *   content: string            — the memory text (gets embedded)
 *   tenantId: string
 *   userId: string
 *   chatbotChannelId: string
 *   sessionId?: string
 *   metadata?: Record<string, any>  — type-specific extra data
 *   source?: 'agent' | 'user_confirmed' | 'system' | 'api'
 *   agentId?: string
 */
router.post('/ingest', async (req: Request, res: Response) => {
    try {
        const {
            type,
            content,
            tenantId,
            userId,
            chatbotChannelId,
            sessionId,
            metadata,
            source,
            agentId,
        } = req.body;

        if (!content || !type) {
            return res.status(400).json({ error: 'Missing required fields: content, type' });
        }
        if (!chatbotChannelId || !tenantId || !userId) {
            return res.status(400).json({ error: 'Missing scoping fields: tenantId, userId, chatbotChannelId' });
        }

        // Validate memory type
        if (!Object.values(MemoryType).includes(type)) {
            return res.status(400).json({
                error: `Invalid memory type: ${type}. Valid types: ${Object.values(MemoryType).join(', ')}`
            });
        }

        const proposed: ProposedMemory = {
            type: type as MemoryType,
            content,
            tenant_id: tenantId,
            user_id: userId,
            chatbot_channel_id: chatbotChannelId,
            originating_session_id: sessionId,
            metadata: metadata || {},
            source: source || 'api',
        };

        const memoryId = await container.intakeService.ingestMemory(
            proposed,
            agentId || 'api-consumer'
        );

        res.json({ success: true, memoryId });

    } catch (err: any) {
        console.error('Ingest Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/v1/memory/search
 * 
 * Semantic search across all memory types.
 * 
 * Body:
 *   query: string           — natural language search query
 *   tenantId: string
 *   userId: string
 *   chatbotChannelId: string
 *   types?: MemoryType[]    — optional filter by memory type(s)
 *   limit?: number          — max results (default 10)
 *   minConfidence?: number  — minimum confidence threshold
 */
router.post('/search', async (req: Request, res: Response) => {
    try {
        const { query, tenantId, userId, chatbotChannelId, types, limit, minConfidence } = req.body;

        if (!query || !chatbotChannelId || !tenantId || !userId) {
            return res.status(400).json({ error: 'Missing required fields: query, tenantId, userId, chatbotChannelId' });
        }

        // Generate embedding for the search query
        const queryEmbedding = await container.embeddingService.generateEmbedding(query);

        const results = await container.ltmStore.search(
            queryEmbedding,
            tenantId,
            chatbotChannelId,
            userId,
            {
                types: types ? types.map((t: string) => t as MemoryType) : undefined,
                limit: limit || 10,
                minConfidence: minConfidence || 0.0,
                includeGlobal: true,
            }
        );

        res.json({
            query,
            count: results.length,
            results: results.map(r => ({
                memoryId: r.memory_id,
                type: r.type,
                content: r.content,
                confidence: r.confidence,
                relevanceScore: r.score,
                metadata: r.metadata,
                status: r.status,
                createdAt: r.created_at,
            })),
        });

    } catch (err: any) {
        console.error('Search Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/v1/memory/context
 * 
 * Assemble context for an agent. Returns a token-budgeted,
 * prompt-ready string with STM + relevant LTM memories.
 */
router.get('/context', async (req: Request, res: Response) => {
    try {
        const {
            sessionId,
            chatbotId,
            tenantId,
            userId,
            query,
            role,
            step,
            tokenBudget,
        } = req.query;

        if (!sessionId || !chatbotId) {
            return res.status(400).json({ error: 'Missing sessionId or chatbotId' });
        }

        const context = await container.assembler.assembleContext({
            userChannelSessionId: sessionId as string,
            chatbotChannelId: chatbotId as string,
            tenantId: (tenantId as string) || 'default',
            userId: (userId as string) || 'user',
            agentRole: (role as string) || 'assistant',
            workflowStep: (step as string) || 'chat',
            tokenBudget: tokenBudget ? parseInt(tokenBudget as string) : 2000,
            queryText: query as string,
        });

        res.json({ context });

    } catch (err: any) {
        console.error('Context Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/v1/memory/:memoryId
 * 
 * Get a specific memory by ID.
 */
router.get('/:memoryId', async (req: Request, res: Response) => {
    try {
        const memoryId = req.params.memoryId as string;
        const memory = await container.ltmStore.getById(memoryId);

        if (!memory) {
            return res.status(404).json({ error: 'Memory not found' });
        }

        res.json({
            memoryId: memory.memory_id,
            type: memory.type,
            content: memory.content,
            confidence: memory.confidence,
            strength: memory.strength,
            status: memory.status,
            metadata: memory.metadata,
            authorityLevel: memory.authority_level,
            createdAt: memory.created_at,
            updatedAt: memory.updated_at,
        });

    } catch (err: any) {
        console.error('Get Memory Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

export default router;
