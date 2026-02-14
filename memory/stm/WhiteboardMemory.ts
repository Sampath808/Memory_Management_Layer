
import { MemoryType } from '../types/MemoryBlock';

/**
 * Whiteboard Memory Structure (Ephemeral Multi-Agent Workspace)
 * Temporary shared reasoning space.
 */
export interface WhiteboardMemory {
    session_id: string;
    chatbot_channel_id: string;

    notes: string[];
    hypotheses: string[];
    intermediate_results: any[];

    last_updated_by_agent: string;
    ttl_expiry: number; // TTL in seconds or timestamp
}

/**
 * Whiteboard Data Transfer Object
 */
export interface WhiteboardDTO {
    memory_type: 'whiteboard';
    data: WhiteboardMemory;
}
