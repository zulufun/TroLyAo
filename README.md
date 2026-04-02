# Local React + LangChain RAG (Excel Incident Response)

This project is now fully n8n-free. The stack runs local-first with a Python API using LangChain.

- Frontend: React + TSX (document management + chat)
- Backend: FastAPI + LangChain
- LLM runtime: Ollama (local)
- Vector DB: Qdrant (local)
- Source data: Excel (.xlsx, .xls)

## Architecture

1. User uploads Excel from frontend to backend.
2. Backend stores the original Excel bytes inside SQLite as BLOB, not as a file path.
3. Backend parses Excel rows and indexes embeddings to Qdrant via LangChain (`OllamaEmbeddings`).
4. User asks incident question in chat.
5. Backend recommends relevant documents (based on `Sự cố`) and performs RAG retrieval in Qdrant.
6. Backend calls local Ollama chat model (`ChatOllama`) and returns answer + sources.

## Suggested models

Low-resource local machine:

- Chat model: qwen2.5:3b-instruct-q4_K_M
- Embedding model: nomic-embed-text

Server-side larger test model:

- Chat model: qwen2.5:14b-instruct-q4_K_M
- Embedding model: bge-m3

## Storage layout

- Document file bytes + metadata: `./storage/data/documents.db` (SQLite BLOB)
- Vector index: `./storage/qdrant`
- Ollama model cache: `./storage/ollama`

## Project structure

- `frontend/`: React UI with sidebar (Document Management / Q&A)
- `backend/`: FastAPI + LangChain RAG service
- `storage/`: persistent local data
- `docker-compose.yml`: full local runtime

## Run full stack

```bash
docker compose up -d --build
```

If Ubuntu permissions were previously changed by sudo:

```bash
sudo chown -R 1000:1000 ./storage/data ./storage/qdrant
```

Open apps:

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/docs
- Qdrant: http://localhost:6333

## Main backend APIs

- `POST /api/documents/upload`
- `GET /api/documents`
- `POST /api/documents/{document_id}/reindex`
- `DELETE /api/documents/{document_id}`
- `POST /api/documents/recommend`
- `POST /api/chat`
- `GET /api/documents/{document_id}/download`

## Excel schema support

Designed for incident response sheets containing columns like:

- `Sự cố`
- `Trường hợp`
- `Server`
- `Account`
- `Dấu hiện`
- `Cách xử lý`
- `Ngoại lệ`

The backend prioritizes these columns when indexing and answering, and can return a direct high-confidence response from the best matched row before invoking the LLM.

## Security notes

1. Keep services bound to localhost in production-like environments.
2. Do not expose Ollama/Qdrant publicly without access control.
3. Back up `./storage/data` and `./storage/qdrant` regularly.
