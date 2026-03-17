# Memory Management Layer

Smart memory management system for agentic chatbots with confidence scoring and MongoDB storage.

## Memory Types

- **Semantic**: Facts and preferences about the user
- **Procedural**: How-to knowledge, workflows, processes
- **Episodic**: Contextual events and conversation learnings

## Confidence Scoring

Initial confidence is calculated based on:
- **Source reliability**: User statements (high), AI inference (medium), agent (lower)
- **Clarity**: Explicit (high), implied (medium), ambiguous (low)
- **Memory type**: Semantic memories get slight boost

Confidence can be:
- **Reinforced**: When similar information appears again (+0.1)
- **Decayed**: When contradictions occur (-0.3)
- **Time-decayed**: Gradual decrease based on last access time

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## API Endpoints

### POST /api/memory/save

Manually save a memory to MongoDB (you provide classification).

**Request Body:**
```json
{
  "mongoUri": "mongodb://localhost:27017",
  "dbName": "chatbot_memories",
  "memoriesCollectionName": "memories",
  "memory": {
    "content": "User prefers dark mode",
    "type": "semantic",
    "userId": "user123",
    "projectId": "proj456",
    "metadata": {
      "source": "user",
      "clarity": "explicit"
    },
    "tags": ["preference", "ui"]
  }
}
```

### POST /api/memory/intelligent-save

Intelligently save a memory - AI automatically classifies type, generates embedding, and structures the data.

**Request Body:**
```json
{
  "mongoUri": "mongodb://localhost:27017",
  "dbName": "chatbot_memories",
  "memoriesCollectionName": "memories",
  "message": "I really prefer using dark mode in all my applications",
  "userId": "user123",
  "projectId": "proj456",
  "workspaceId": "workspace789",
  "context": [
    {
      "role": "user",
      "content": "Can you help me with my settings?"
    },
    {
      "role": "assistant",
      "content": "Of course! What would you like to configure?"
    }
  ]
}
```

**Note:** You can pass any additional metadata fields (userId, projectId, workspaceId, sessionId, etc.) and they will be stored at the root level for easy filtering during retrieval.

**Response:**
```json
{
  "success": true,
  "memoryId": "507f1f77bcf86cd799439011",
  "classification": {
    "type": "semantic",
    "source": "user",
    "clarity": "explicit",
    "tags": ["preference", "ui", "dark-mode"],
    "reasoning": "User explicitly stated a preference about UI settings"
  }
}
```

## Environment Variables

Create a `.env` file:
```
PORT=3000
OPENAI_API_KEY=your_openai_api_key_here
```
