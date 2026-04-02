# Local React + n8n RAG Chatbot (Excel/Word)

This workspace provides a practical structure to build a fully local chatbot RAG:

- Frontend: ReactJS (Vite)
- Backend: Python FastAPI (document repository + routing)
- Orchestration: n8n
- LLM runtime: Ollama (local)
- Vector database: Qdrant (local disk persistence)
- Data source files: .xlsx, .xls, .docx

## Why this stack

Based on common open-source patterns in GitHub projects for local RAG pipelines:

1. Ollama + Qdrant + lightweight UI is the most common local-first baseline.
2. n8n gives low-code observability and faster iteration compared to writing all orchestration code manually.
3. Qdrant is easier to operate locally than distributed-heavy alternatives and has very good retrieval performance.
4. bge-m3 embedding is multilingual and usually stronger for Vietnamese retrieval than many generic embedding models.

## GitHub references used

The architecture choices were aligned with these active open-source references:

1. n8n self-hosted stack pattern:
   - https://github.com/n8n-io/self-hosted-ai-starter-kit
   - Confirms local combination n8n + Ollama + Qdrant with mounted local files.
2. Local model runtime pattern:
   - https://github.com/ollama/ollama
   - Confirms stable local REST API and Docker-first operations.
3. Vector storage pattern:
   - https://github.com/qdrant/qdrant
   - Confirms local persistent storage, filtering payload, and high-performance retrieval.
4. Practical local-first product benchmark:
   - https://github.com/open-webui/open-webui
   - Confirms offline/self-hosted RAG trend and broad vector DB support, including Qdrant.

From these references, the chosen architecture is intentionally minimal and production-friendly: React UI + n8n workflow layer + Ollama inference + Qdrant vector store.

## Suggested local models

- Primary chat model: qwen2.5:7b-instruct-q4_K_M
- Backup chat model: llama3.1:8b-instruct-q4_K_M
- Embedding model: bge-m3
- Lightweight fallback embedding: nomic-embed-text

## Storage recommendation (local)

Recommended architecture:

1. Vector store: Qdrant with volume ./storage/qdrant
2. Workflow and credentials: n8n default sqlite in ./storage/n8n
3. Raw files archive: ./storage/data
4. Optional metadata index: sqlite/postgres if you need advanced analytics

For small-medium internal knowledge bases, Qdrant + local disk gives the best balance of speed, simplicity, and maintainability.

## Project structure

- frontend/: React app for upload + chat
- backend/: FastAPI service for document management and n8n gateway
- n8n/workflows/: workflow design for ingest/chat
- n8n/prompts/: prompt templates
- storage/: persistent local data (runtime generated)
- docker-compose.yml: local stack bootstrap

## Quick start

1. Start full stack (frontend + backend + n8n + qdrant + ollama):

   docker compose up -d --build

2. If you are on Ubuntu and previously ran containers with sudo, reset local volume permissions once:

   sudo chown -R 1000:1000 ./storage/n8n ./storage/data ./storage/qdrant

3. Open n8n:

   http://localhost:5678

4. Open frontend:

   http://localhost:5173

5. Configure n8n webhooks:

   - POST /webhook/ingest-excel
   - POST /webhook/chat

6. Update frontend environment (if backend URL changed):

   - copy frontend/.env.example to frontend/.env
   - set VITE_API_BASE_URL if changed

## Backend responsibilities

1. Store uploaded Excel files in local disk: ./storage/data/excel
2. Manage document metadata via sqlite: ./storage/data/documents.db
3. Provide API for frontend: upload/list/delete/recommend/chat
4. Provide API for n8n: fetch rows or download file by document id

## Optional local frontend run (without Docker)

If you do not want frontend in compose, run it manually:

   cd frontend
   npm install
   npm run dev

## n8n workflow blueprint

See n8n/workflows/README.md for node-by-node design.

## Performance tuning checklist

1. Chunk size: 700-1200 chars, overlap 120-160 chars
2. Retrieval topK: start at 8, tune to 6-10
3. Add reranking later if answers are noisy
4. Keep citations mandatory in prompt
5. Track latency at each node in n8n

## Security notes for local deployment

1. Set strong N8N_ENCRYPTION_KEY and basic auth credentials.
2. Bind services only to localhost when not sharing network.
3. Do not expose Ollama and Qdrant publicly without reverse proxy and auth.
