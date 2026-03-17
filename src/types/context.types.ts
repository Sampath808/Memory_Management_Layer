export interface BuildContextRequest {
  mongoUri: string;
  dbName: string;
  memoriesCollectionName: string;
  chatCollectionName: string;
  aiModel: string;
  systemPrompts: string;
  currentPrompt: string;
  memoryFilters: Record<string, any>; // Filters for memories collection
  chatFilters: Record<string, any>; // Filters for chat collection
  reserveForResponse?: number;
  recentMessageCount?: number; // How many recent messages to include (default: 10)
  includeDebugInfo?: boolean; // Whether to include token usage and metadata (default: false)
  vectorIndexName?: string; // Name of the vector search index (default: "vector_index")
  maxMemoryCandidates?: number; // Max candidates for vector search (default: 100)
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface ContextBuildResult {
  success: boolean;
  context: string; // Ready-to-use formatted context
  _debug?: { // Optional debug info (only if requested)
    tokenUsage: {
      totalContextWindow: number;
      systemPromptTokens: number;
      currentPromptTokens: number;
      reservedForResponse: number;
      safetyBuffer: number;
      availableForContext: number;
      usedForContext: number;
      recentChatTokens: number;
      memoriesTokens: number;
    };
    metadata: {
      memoriesRetrieved: number;
      chatMessagesRetrieved: number;
      model: string;
    };
  };
}
