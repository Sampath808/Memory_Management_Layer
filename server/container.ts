import { Pool } from 'pg';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';

// Stores
import { SqlMemoryIndex } from '../memory/store/SqlMemoryIndex';
import { SqlChatbotRegistry } from '../memory/store/SqlChatbotRegistry';
import { LTMStore } from '../memory/ltm/LTMStore';
import { EmbeddingService } from '../memory/ltm/EmbeddingService';
import { STMStore } from '../memory/stm/STMStore';
import { ChatHistoryStore } from '../chatbot/history/ChatHistoryStore';

// Services
import { IntakeService } from '../memory/lifecycle/IntakeService';
import { PromotionService } from '../memory/lifecycle/PromotionService';
import { WhiteboardService } from '../memory/stm/WhiteboardService';
import { ConflictResolver } from '../memory/lifecycle/ConflictResolver';
import { DecayService } from '../memory/lifecycle/DecayService';
import { ChatbotMemoryAssembler } from '../retrieval/ChatbotMemoryAssembler';

// Agents
import { MemoryManagerAgent } from '../agents/MemoryManagementAgent';

// Config (env vars)
const PG_CONNECTION_STRING =
  process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/memory_layer';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'memory_db';

export class ServiceContainer {
  // Stores
  public sqlIndex: SqlMemoryIndex;
  public registry: SqlChatbotRegistry;
  public ltmStore: LTMStore;
  public embeddingService: EmbeddingService;
  public stmStore: STMStore;
  public chatStore: ChatHistoryStore;

  // Services
  public intakeService: IntakeService;
  public whiteboardService: WhiteboardService;
  public promotionService: PromotionService;
  public assembler: ChatbotMemoryAssembler;

  // Agents
  public memoryManager: MemoryManagerAgent;

  // Connections
  private pgPool: Pool;
  private redisClient: Redis;
  private mongoClient: MongoClient;

  constructor() {
    this.pgPool = new Pool({ connectionString: PG_CONNECTION_STRING });
    this.redisClient = new Redis(REDIS_URL);
    this.mongoClient = new MongoClient(MONGO_URL);
  }

  async init() {
    await this.mongoClient.connect();
    console.log('[Container] Connected to MongoDB');

    // ── 1. Core Stores ──
    this.sqlIndex = new SqlMemoryIndex(this.pgPool);
    this.registry = new SqlChatbotRegistry(this.pgPool);

    // Unified LTM Store — one collection for all memory types
    this.ltmStore = new LTMStore(this.mongoClient, DB_NAME);

    // Real embeddings via OpenAI
    this.embeddingService = new EmbeddingService();

    this.stmStore = new STMStore(this.redisClient);
    this.chatStore = new ChatHistoryStore(this.mongoClient, DB_NAME);

    // Ensure Mongo indexes
    await this.ltmStore.ensureIndexes();

    // ── 2. Services ──
    this.intakeService = new IntakeService(
      this.sqlIndex,
      this.ltmStore,
      this.embeddingService,
    );
    this.whiteboardService = new WhiteboardService(this.redisClient);
    this.promotionService = new PromotionService(this.sqlIndex);

    // Memory retrieval assembler
    this.assembler = new ChatbotMemoryAssembler(
      this.stmStore,
      this.ltmStore,
      this.sqlIndex,
      this.embeddingService,
    );

    // ── 3. Agents ──
    this.memoryManager = new MemoryManagerAgent(
      this.intakeService,
      this.sqlIndex,
      this.ltmStore,
      this.embeddingService,
      this.promotionService,
    );

    console.log('[Container] All services initialized');
  }

  async close() {
    await this.pgPool.end();
    await this.redisClient.quit();
    await this.mongoClient.close();
  }
}

export const container = new ServiceContainer();
