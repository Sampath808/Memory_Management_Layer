# MongoDB Atlas Vector Search Index Setup

To use the context building API, you need to create a vector search index on your memories collection.

## Steps to Create Vector Index

### 1. Go to MongoDB Atlas Console
- Navigate to your cluster
- Click on "Atlas Search" tab
- Click "Create Search Index"

### 2. Choose "JSON Editor"

### 3. Use This Index Definition

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "userId"
    },
    {
      "type": "filter",
      "path": "projectId"
    },
    {
      "type": "filter",
      "path": "workspaceId"
    },
    {
      "type": "filter",
      "path": "type"
    },
    {
      "type": "filter",
      "path": "importance"
    }
  ]
}
```

### 4. Configuration
- **Index Name**: `vector_index` (or specify custom name in API request)
- **Database**: Your database name
- **Collection**: Your memories collection name
- **Dimensions**: 1536 (for OpenAI text-embedding-3-small)

### 5. Wait for Index to Build
- Initial build may take a few minutes
- Status will show "Active" when ready

## Using Custom Index Name

If you use a different index name, pass it in the API request:

```json
{
  "vectorIndexName": "my_custom_index",
  ...
}
```

## Troubleshooting

If you get an error about vector search index not found:
1. Verify the index is created and "Active" in Atlas
2. Check the index name matches your API request
3. Ensure the collection name is correct
4. Wait a few minutes after creation for index to be ready

## Filter Fields

Add filter fields for any metadata you want to filter on during search:
- userId
- projectId
- workspaceId
- teamId
- chatbotId
- etc.

These allow you to scope vector search to specific users/projects.
