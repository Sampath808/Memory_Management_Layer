import { MongoClient, Db } from 'mongodb';
import { BuildContextRequest, ContextBuildResult, ChatMessage } from '../types/context.types';
import { Memory } from '../types/memory.types';
import { TokenizerService } from '../utils/tokenizer';
import { ClassifierService } from './classifier.service';

export class ContextService {
  private static clients: Map<string, MongoClient> = new Map();
  private classifier: ClassifierService;

  constructor(openaiApiKey: string) {
    this.classifier = new ClassifierService(openaiApiKey);
  }

  private static async getClient(mongoUri: string): Promise<MongoClient> {
    let client = this.clients.get(mongoUri);
    if (!client) {
      client = new MongoClient(mongoUri);
      await client.connect();
      this.clients.set(mongoUri, client);
    }
    return client;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  async buildContext(request: BuildContextRequest): Promise<ContextBuildResult> {
    const {
      mongoUri,
      dbName,
      memoriesCollectionName,
      chatCollectionName,
      aiModel,
      systemPrompts,
      currentPrompt,
      memoryFilters,
      chatFilters,
      reserveForResponse,
      recentMessageCount = 10,
      vectorIndexName = 'vector_index',
      maxMemoryCandidates = 100,
    } = request;

    // Step 1: Calculate available token budget
    const tokenBudget = TokenizerService.calculateAvailableTokens(
      aiModel,
      systemPrompts,
      currentPrompt,
      reserveForResponse
    );

    // Step 2: Allocate token budget
    const recentChatBudget = Math.floor(tokenBudget.availableForContext * 0.3);
    const memoriesBudget = Math.floor(tokenBudget.availableForContext * 0.7);

    // Step 3: Get MongoDB client
    const client = await ContextService.getClient(mongoUri);
    const db: Db = client.db(dbName);

    // Step 4: Fetch recent chat history
    const chatCollection = db.collection(chatCollectionName);
    const recentMessages = await chatCollection
      .find(chatFilters)
      .sort({ timestamp: -1 })
      .limit(recentMessageCount)
      .toArray();

    const recentChat: ChatMessage[] = recentMessages
      .reverse()
      .map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      }));

    // Calculate tokens used by recent chat
    let recentChatTokens = 0;
    const fittingRecentChat: ChatMessage[] = [];
    for (const msg of recentChat) {
      const msgTokens = TokenizerService.countTokens(
        `${msg.role}: ${msg.content}`,
        aiModel
      );
      if (recentChatTokens + msgTokens <= recentChatBudget) {
        fittingRecentChat.push(msg);
        recentChatTokens += msgTokens;
      } else {
        break;
      }
    }

    // Step 5: Generate embedding for current prompt
    const promptEmbedding = await this.classifier.generateEmbedding(currentPrompt);

    // Step 6: Vector search for relevant memories using MongoDB Atlas Vector Search
    const memoriesCollection = db.collection<Memory>(memoriesCollectionName);
    
    try {
      // Build the aggregation pipeline
      const pipeline: any[] = [
        {
          $vectorSearch: {
            index: vectorIndexName,
            path: 'embedding',
            queryVector: promptEmbedding,
            numCandidates: maxMemoryCandidates,
            limit: 50, // Get top 50 candidates
          }
        },
        {
          $addFields: {
            similarity: { $meta: 'vectorSearchScore' }
          }
        }
      ];

      // Add filters if provided
      if (Object.keys(memoryFilters).length > 0) {
        pipeline.push({ $match: memoryFilters });
      }

      const vectorSearchResults = await memoriesCollection.aggregate(pipeline).toArray();

      // Step 7: Rank memories with weighted scoring
      const rankedMemories = vectorSearchResults.map((mem: any) => {
        const similarity = mem.similarity || 0;
        
        // Weighted score: similarity + confidence + importance
        const importanceWeight = mem.importance === 'high' ? 0.3 : mem.importance === 'medium' ? 0.15 : 0.05;
        const score = similarity * 0.6 + mem.confidence * 0.1 + importanceWeight;
        
        return {
          ...mem,
          similarity,
          score,
        };
      }).sort((a, b) => b.score - a.score);

      // Step 8: Fill memories budget
      let memoriesTokens = 0;
      const selectedMemories: any[] = [];
      
      for (const mem of rankedMemories) {
        const memTokens = TokenizerService.countTokens(mem.content, aiModel);
        if (memoriesTokens + memTokens <= memoriesBudget) {
          selectedMemories.push({
            content: mem.content,
            type: mem.type,
            confidence: mem.confidence,
            importance: mem.importance,
            tags: mem.tags,
            similarity: mem.similarity,
          });
          memoriesTokens += memTokens;
        } else {
          break;
        }
      }

      const totalUsed = recentChatTokens + memoriesTokens;

      // Step 9: Format context as a clean string
    let contextString = '';

    // Add relevant memories section
    if (selectedMemories.length > 0) {
      contextString += '# Relevant Information\n\n';
      
      // Group by type
      const semanticMems = selectedMemories.filter(m => m.type === 'semantic');
      const proceduralMems = selectedMemories.filter(m => m.type === 'procedural');
      const episodicMems = selectedMemories.filter(m => m.type === 'episodic');

      if (semanticMems.length > 0) {
        contextString += '## User Preferences & Facts\n';
        semanticMems.forEach(mem => {
          contextString += `- ${mem.content}\n`;
        });
        contextString += '\n';
      }

      if (proceduralMems.length > 0) {
        contextString += '## Workflows & Processes\n';
        proceduralMems.forEach(mem => {
          contextString += `- ${mem.content}\n`;
        });
        contextString += '\n';
      }

      if (episodicMems.length > 0) {
        contextString += '## Past Learnings\n';
        episodicMems.forEach(mem => {
          contextString += `- ${mem.content}\n`;
        });
        contextString += '\n';
      }
    }

    // Add recent conversation
    if (fittingRecentChat.length > 0) {
      contextString += '# Recent Conversation\n\n';
      fittingRecentChat.forEach(msg => {
        const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
        contextString += `${role}: ${msg.content}\n\n`;
      });
    }

    const result: ContextBuildResult = {
      success: true,
      context: contextString.trim(),
    };

    // Add debug info if requested
    if (request.includeDebugInfo) {
      result._debug = {
        tokenUsage: {
          ...tokenBudget,
          usedForContext: totalUsed,
          recentChatTokens,
          memoriesTokens,
        },
        metadata: {
          memoriesRetrieved: selectedMemories.length,
          chatMessagesRetrieved: fittingRecentChat.length,
          model: aiModel,
        },
      };
    }

    return result;

    } catch (error: any) {
      // If vector search fails (e.g., index doesn't exist), throw descriptive error
      if (error.code === 291 || error.message?.includes('$vectorSearch')) {
        throw new Error(
          `Vector search index "${vectorIndexName}" not found. Please create a vector search index on the "embedding" field in collection "${memoriesCollectionName}". ` +
          `See: https://www.mongodb.com/docs/atlas/atlas-vector-search/create-index/`
        );
      }
      throw error;
    }
  }

  static async closeConnections(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
    TokenizerService.cleanup();
  }
}
