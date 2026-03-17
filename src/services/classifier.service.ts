import OpenAI from 'openai';
import { MemoryType } from '../types/memory.types';

export interface ClassificationResult {
  type: MemoryType;
  content: string;
  source: 'user' | 'ai_inference' | 'agent';
  clarity: 'explicit' | 'implied' | 'ambiguous';
  tags: string[];
  reasoning: string;
  shouldSave: boolean;
  importance: 'high' | 'medium' | 'low';
}

export class ClassifierService {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async classifyMemory(
    message: string,
    context?: { role: 'user' | 'assistant' | 'system'; content: string }[]
  ): Promise<ClassificationResult> {
    const systemPrompt = `You are a memory extraction and classification agent for a chatbot system. Your job is to:
1. Determine if a message contains memory-worthy information
2. Extract ONLY the relevant memory content (not the entire message)
3. Classify the memory type

Memory Types:
- semantic: Facts, preferences, personal information about the user (e.g., "I prefer dark mode", "I live in NYC", "I'm a software engineer")
- procedural: How-to knowledge, workflows, processes, steps to accomplish tasks (e.g., "To deploy, run npm build then push to main", "I use Jest for testing")
- episodic: Contextual events, conversation learnings, things discovered during interaction (e.g., "We fixed the login bug by updating the auth token", "User struggled with the API documentation")

Source Types:
- user: Direct statement from the user
- ai_inference: Inferred from user behavior or implicit statements
- agent: Learned by the assistant during conversation

Clarity Levels:
- explicit: Clear, direct statement
- implied: Can be reasonably inferred
- ambiguous: Unclear or uncertain

Importance Levels:
- high: Critical information, strong preferences, important facts
- medium: Useful information, moderate preferences
- low: Minor details, weak preferences

IMPORTANT: 
- Extract ONLY the memory-worthy part, not the entire message
- If a long message contains one preference, extract just that preference
- Set shouldSave to false if the message contains no memory-worthy information (e.g., greetings, questions without context, generic responses)
- Be concise - the extracted content should be a clean, standalone memory

Respond ONLY with valid JSON in this exact format:
{
  "shouldSave": true | false,
  "type": "semantic" | "procedural" | "episodic",
  "content": "extracted memory content (concise and standalone)",
  "source": "user" | "ai_inference" | "agent",
  "clarity": "explicit" | "implied" | "ambiguous",
  "importance": "high" | "medium" | "low",
  "tags": ["relevant", "tags"],
  "reasoning": "brief explanation of why this should/shouldn't be saved and what was extracted"
}`;

    const userPrompt = `Analyze this message and extract any memory-worthy information:

Message: "${message}"

${context ? `\nRecent context:\n${context.map(c => `${c.role}: ${c.content}`).join('\n')}` : ''}

Extract and classify any memory-worthy content.`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content || '{}');
    
    return {
      shouldSave: result.shouldSave ?? true,
      type: result.type || 'semantic',
      content: result.content || message,
      source: result.source || 'user',
      clarity: result.clarity || 'implied',
      importance: result.importance || 'medium',
      tags: result.tags || [],
      reasoning: result.reasoning || ''
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    return response.data[0].embedding;
  }
}
