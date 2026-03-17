import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ContextService } from '../services/context.service';

const router = Router();

const BuildContextSchema = z.object({
  mongoUri: z.string().min(1),
  dbName: z.string().min(1),
  memoriesCollectionName: z.string().min(1),
  chatCollectionName: z.string().min(1),
  aiModel: z.string().min(1),
  systemPrompts: z.string().min(1),
  currentPrompt: z.string().min(1),
  memoryFilters: z.record(z.any()),
  chatFilters: z.record(z.any()),
  reserveForResponse: z.number().optional(),
  recentMessageCount: z.number().optional(),
  includeDebugInfo: z.boolean().optional(),
  vectorIndexName: z.string().optional(),
  maxMemoryCandidates: z.number().optional(),
});

router.post('/build', async (req: Request, res: Response) => {
  try {
    const validatedData = BuildContextSchema.parse(req.body);
    
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const contextService = new ContextService(openaiApiKey);
    const result = await contextService.buildContext(validatedData);
    
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      console.error('Error building context:', error);
      res.status(500).json({ error: 'Failed to build context' });
    }
  }
});

export default router;
