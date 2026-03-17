import { encoding_for_model, get_encoding, Tiktoken } from 'tiktoken';

interface ModelConfig {
  contextWindow: number;
  defaultReserveForResponse: number;
  encoding: string;
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // OpenAI Models
  'gpt-4o': { contextWindow: 128000, defaultReserveForResponse: 4096, encoding: 'o200k_base' },
  'gpt-4o-mini': { contextWindow: 128000, defaultReserveForResponse: 4096, encoding: 'o200k_base' },
  'gpt-4-turbo': { contextWindow: 128000, defaultReserveForResponse: 4096, encoding: 'cl100k_base' },
  'gpt-4-turbo-preview': { contextWindow: 128000, defaultReserveForResponse: 4096, encoding: 'cl100k_base' },
  'gpt-4': { contextWindow: 8192, defaultReserveForResponse: 2048, encoding: 'cl100k_base' },
  'gpt-3.5-turbo': { contextWindow: 16385, defaultReserveForResponse: 2048, encoding: 'cl100k_base' },
  'gpt-3.5-turbo-16k': { contextWindow: 16385, defaultReserveForResponse: 2048, encoding: 'cl100k_base' },
  
  // Anthropic Claude Models (approximate, uses cl100k_base for estimation)
  'claude-3-5-sonnet': { contextWindow: 200000, defaultReserveForResponse: 8192, encoding: 'cl100k_base' },
  'claude-3-opus': { contextWindow: 200000, defaultReserveForResponse: 8192, encoding: 'cl100k_base' },
  'claude-3-sonnet': { contextWindow: 200000, defaultReserveForResponse: 4096, encoding: 'cl100k_base' },
  'claude-3-haiku': { contextWindow: 200000, defaultReserveForResponse: 4096, encoding: 'cl100k_base' },
  
  // Google Gemini Models (approximate)
  'gemini-1.5-pro': { contextWindow: 2000000, defaultReserveForResponse: 8192, encoding: 'cl100k_base' },
  'gemini-1.5-flash': { contextWindow: 1000000, defaultReserveForResponse: 8192, encoding: 'cl100k_base' },
  'gemini-pro': { contextWindow: 32768, defaultReserveForResponse: 4096, encoding: 'cl100k_base' },
};

export class TokenizerService {
  private static encoders: Map<string, Tiktoken> = new Map();

  static getModelConfig(model: string): ModelConfig {
    const config = MODEL_CONFIGS[model];
    if (!config) {
      // Default fallback
      return {
        contextWindow: 128000,
        defaultReserveForResponse: 4096,
        encoding: 'cl100k_base'
      };
    }
    return config;
  }

  static getEncoder(encodingName: string): Tiktoken {
    if (!this.encoders.has(encodingName)) {
      const encoder = get_encoding(encodingName as any);
      this.encoders.set(encodingName, encoder);
    }
    return this.encoders.get(encodingName)!;
  }

  static countTokens(text: string, model: string): number {
    const config = this.getModelConfig(model);
    const encoder = this.getEncoder(config.encoding);
    const tokens = encoder.encode(text);
    return tokens.length;
  }

  static calculateAvailableTokens(
    model: string,
    systemPrompts: string,
    currentPrompt: string,
    reserveForResponse?: number
  ): {
    totalContextWindow: number;
    systemPromptTokens: number;
    currentPromptTokens: number;
    reservedForResponse: number;
    safetyBuffer: number;
    availableForContext: number;
  } {
    const config = this.getModelConfig(model);
    const reserve = reserveForResponse ?? config.defaultReserveForResponse;
    
    const systemPromptTokens = this.countTokens(systemPrompts, model);
    const currentPromptTokens = this.countTokens(currentPrompt, model);
    
    // 5% safety buffer
    const safetyBuffer = Math.floor(config.contextWindow * 0.05);
    
    const availableForContext = 
      config.contextWindow 
      - systemPromptTokens 
      - currentPromptTokens 
      - reserve 
      - safetyBuffer;

    return {
      totalContextWindow: config.contextWindow,
      systemPromptTokens,
      currentPromptTokens,
      reservedForResponse: reserve,
      safetyBuffer,
      availableForContext: Math.max(0, availableForContext),
    };
  }

  static cleanup(): void {
    for (const encoder of this.encoders.values()) {
      encoder.free();
    }
    this.encoders.clear();
  }
}
