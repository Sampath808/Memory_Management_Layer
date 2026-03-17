import { Memory } from '../types/memory.types';

export class ConfidenceCalculator {
  static calculateInitialConfidence(
    source: Memory['metadata']['source'],
    clarity: Memory['metadata']['clarity'],
    type: Memory['type']
  ): number {
    let confidence = 0.5;

    // Source reliability
    switch (source) {
      case 'user':
        confidence += 0.4;
        break;
      case 'ai_inference':
        confidence += 0.2;
        break;
      case 'agent':
        confidence += 0.1;
        break;
    }

    // Clarity bonus
    switch (clarity) {
      case 'explicit':
        confidence += 0.3;
        break;
      case 'implied':
        confidence += 0.1;
        break;
      case 'ambiguous':
        confidence -= 0.1;
        break;
    }

    // Type-specific adjustments
    if (type === 'semantic') {
      confidence += 0.05; // Facts are more reliable
    }

    return Math.min(Math.max(confidence, 0.1), 0.95);
  }

  static reinforceConfidence(currentConfidence: number): number {
    return Math.min(currentConfidence + 0.1, 0.95);
  }

  static decayConfidence(currentConfidence: number, contradictionStrength: number = 0.3): number {
    return Math.max(currentConfidence - contradictionStrength, 0.1);
  }

  static timeDecay(confidence: number, daysSinceLastAccess: number, type: Memory['type']): number {
    // Semantic memories decay slower than episodic
    const decayRate = type === 'semantic' ? 0.001 : type === 'procedural' ? 0.002 : 0.005;
    const decay = decayRate * daysSinceLastAccess;
    return Math.max(confidence - decay, 0.1);
  }
}
