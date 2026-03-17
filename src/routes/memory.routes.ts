import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { MemoryService } from '../services/memory.service';

const router = Router();

const IntelligentSaveSchema = z.object({
  mongoUri: z.string().min(1),
  dbName: z.string().min(1),
  memoriesCollectionName: z.string().min(1),
  message: z.string().min(1),
  context: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })).optional(),
}).passthrough(); // Allow any additional metadata fields

// Intelligent save endpoint (AI classifies automatically)
router.post('/intelligent-save', async (req: Request, res: Response) => {
  try {
    const validatedData = IntelligentSaveSchema.parse(req.body);
    
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const memoryService = new MemoryService(openaiApiKey);
    const result = await memoryService.intelligentSave(validatedData);
    
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      console.error('Error saving memory:', error);
      res.status(500).json({ error: 'Failed to save memory' });
    }
  }
});

export default router;
