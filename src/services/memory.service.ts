import { MongoClient, Db } from 'mongodb';
import { Memory, SaveMemoryRequest, IntelligentSaveRequest } from '../types/memory.types';
import { ConfidenceCalculator } from '../utils/confidence';
import { ClassifierService } from './classifier.service';

export class MemoryService {
  private static clients: Map<string, MongoClient> = new Map();
  private classifier: ClassifierService;

  constructor(openaiApiKey: string) {
    this.classifier = new ClassifierService(openaiApiKey);
  }

  static async saveMemory(request: SaveMemoryRequest): Promise<{ success: boolean; memoryId: string }> {
    const { mongoUri, dbName, memoriesCollectionName, memory } = request;

    let client = this.clients.get(mongoUri);
    
    if (!client) {
      client = new MongoClient(mongoUri);
      await client.connect();
      this.clients.set(mongoUri, client);
    }

    const db: Db = client.db(dbName);
    const collection = db.collection<Memory>(memoriesCollectionName);

    const now = new Date();
    
    // Calculate initial confidence if not provided
    const confidence = memory.confidence ?? ConfidenceCalculator.calculateInitialConfidence(
      memory.metadata?.source ?? 'ai_inference',
      memory.metadata?.clarity ?? 'implied',
      memory.type
    );

    const fullMemory = {
      ...memory,
      confidence,
      metadata: {
        source: memory.metadata?.source ?? 'ai_inference',
        clarity: memory.metadata?.clarity ?? 'implied',
        createdAt: now,
        lastAccessed: now,
        accessCount: 0,
        reinforcementCount: 0,
        lastUpdated: now,
        ...memory.metadata,
      },
    };

    const result = await collection.insertOne(fullMemory as any);

    return {
      success: true,
      memoryId: result.insertedId.toString(),
    };
  }

  async intelligentSave(request: IntelligentSaveRequest): Promise<{ 
    success: boolean; 
    memoryId?: string;
    skipped?: boolean;
    classification: {
      type: string;
      source: string;
      clarity: string;
      importance: string;
      tags: string[];
      reasoning: string;
      shouldSave: boolean;
    };
  }> {
    const { mongoUri, dbName, memoriesCollectionName, message, context, ...additionalMetadata } = request;

    // Step 1: Classify and extract memory
    const classification = await this.classifier.classifyMemory(message, context);

    // Step 2: Check if worth saving
    if (!classification.shouldSave) {
      return {
        success: true,
        skipped: true,
        classification: {
          type: classification.type,
          source: classification.source,
          clarity: classification.clarity,
          importance: classification.importance,
          tags: classification.tags,
          reasoning: classification.reasoning,
          shouldSave: false,
        },
      };
    }

    // Step 3: Generate embedding
    const embedding = await this.classifier.generateEmbedding(classification.content);

    // Step 4: Calculate confidence
    const confidence = ConfidenceCalculator.calculateInitialConfidence(
      classification.source,
      classification.clarity,
      classification.type
    );

    // Step 5: Save to MongoDB with all additional metadata at root level
    const saveRequest: SaveMemoryRequest = {
      mongoUri,
      dbName,
      memoriesCollectionName,
      memory: {
        content: classification.content,
        type: classification.type,
        confidence,
        importance: classification.importance,
        embedding,
        tags: classification.tags,
        ...additionalMetadata, // Spread all additional metadata (userId, projectId, etc.) at root level
        metadata: {
          source: classification.source,
          clarity: classification.clarity,
          reasoning: classification.reasoning,
          originalMessage: message, // Store original for reference
        },
      },
    };

    const result = await MemoryService.saveMemory(saveRequest);

    return {
      ...result,
      classification: {
        type: classification.type,
        source: classification.source,
        clarity: classification.clarity,
        importance: classification.importance,
        tags: classification.tags,
        reasoning: classification.reasoning,
        shouldSave: true,
      },
    };
  }

  static async closeConnections(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
  }
}
