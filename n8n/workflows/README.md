# n8n workflow design (local RAG)

## Import-ready workflows

- rag_ingest_excel_local.json
- rag_chat_local.json

In n8n UI, use Import from File and select both JSON files in this folder.

Required webhooks after import:

- POST /webhook/ingest-excel
- POST /webhook/chat

## Workflow 1: ingest_file

1. Webhook (POST /webhook/ingest, binary file)
2. IF node: validate extension (.xlsx, .xls, .docx)
3. Extract From File:
   - XLSX: to text rows
   - DOCX: to plain text
4. Code node:
   - normalize unicode
   - remove noisy whitespace
   - chunk by paragraph with overlap 120-160 chars
   - attach metadata: fileName, sheetName/section, chunkIndex, createdAt
5. Embeddings (Ollama Embeddings): model bge-m3
6. Qdrant Upsert:
   - collection: rag_docs
   - vector size from model
   - payload metadata and raw text
7. Respond to Webhook:
   - status: ok
   - chunks: number indexed

## Workflow 2: rag_chat

1. Webhook (POST /webhook/chat)
2. Set node: question, sessionId
3. Embeddings (Ollama Embeddings): bge-m3 for query
4. Qdrant Search:
   - topK: 6-10
   - score threshold: tune from 0.25 to 0.35
5. Code node:
   - context packing by token budget
   - citation list by fileName + section
6. HTTP Request to Ollama /api/chat:
   - model: qwen2.5:7b-instruct-q4_K_M
   - system prompt: answer only from retrieved context, cite sources
7. Respond to Webhook:
   - answer
   - sources[]
   - debug latency

## Runtime notes

- All services are local in Docker network.
- Qdrant data persisted in ./storage/qdrant.
- n8n workflows and credentials persisted in ./storage/n8n.
- Ollama models persisted in ./storage/ollama.

## Recommended Excel storage strategy in n8n

Use two-layer storage for reliability:

1. Raw Excel archive on local disk:
   - Save files under /data/excel inside n8n container.
   - On host, this maps to ./storage/data/excel.
   - Reason: easy backup and re-indexing.
2. Retrieval storage in Qdrant:
   - Store row text chunks and metadata in payload.
   - Keep fields: fileName, sheetName, rowIndex, uploadedAt.

Suggested extra step in ingest workflow:

- Add Write File to Disk node right after Webhook Ingest to persist original file before parsing.

This model lets you restore vectors anytime from local Excel files without re-uploading.
