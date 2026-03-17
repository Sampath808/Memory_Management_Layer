export type MemoryType = 'semantic' | 'procedural' | 'episodic';

export interface Memory {
  content: string;
  type: MemoryType;
  confidence: number;
  importance: 'high' | 'medium' | 'low';
  embedding?: number[];
  metadata: {
    source: 'user' | 'ai_inference' | 'agent';
    clarity: 'explicit' | 'implied' | 'ambiguous';
    createdAt: Date;
    lastAccessed: Date;
    accessCount: number;
    reinforcementCount: number;
    lastUpdated: Date;
    reasoning?: string;
    originalMessage?: string;
  };
  tags?: string[];
  [key: string]: any; // Allow any additional metadata fields for filtering
}

export interface SaveMemoryRequest {
  mongoUri: string;
  dbName: string;
  memoriesCollectionName: string;
  memory: Omit<Memory, 'metadata'> & {
    metadata?: Partial<Memory['metadata']>;
  };
}

export interface IntelligentSaveRequest {
  mongoUri: string;
  dbName: string;
  memoriesCollectionName: string;
  message: string;
  context?: { role: 'user' | 'assistant' | 'system'; content: string }[];
  [key: string]: any; // Accept any additional metadata (userId, projectId, workspaceId, etc.)
}
