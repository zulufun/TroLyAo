import os
import re
import sqlite3
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_ollama import ChatOllama, OllamaEmbeddings
from pydantic import BaseModel, Field
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, Filter, MatchAny, PointStruct, VectorParams
from qdrant_client.models import FieldCondition

DATA_ROOT = Path(os.getenv("DOC_DATA_ROOT", "/data"))
EXCEL_DIR = DATA_ROOT / "excel"
DB_PATH = DATA_ROOT / "documents.db"
QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "rag_incident_docs")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")
OLLAMA_CHAT_MODEL = os.getenv("OLLAMA_CHAT_MODEL", "qwen2.5:7b-instruct-q4_K_M")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "bge-m3")

app = FastAPI(title="RAG Document Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

qdrant_client: QdrantClient | None = None
embeddings_model: OllamaEmbeddings | None = None
chat_model: ChatOllama | None = None
rag_prompt = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Ban la tro ly ung cuu su co. Chi duoc su dung thong tin trong context truy xuat."
            " Neu khong du du lieu, phai noi ro khong du du lieu."
            " Luon dua huong dan xu ly ngan gon, ro rang, co trich dan nguon.",
        ),
        (
            "human",
            "Context:\n{context}\n\nCau hoi su co: {question}\n"
            "Tra loi bang tieng Viet va co muc 'Nguon tham chieu'.",
        ),
    ]
)


def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def normalize_text(text: str) -> str:
    text = text.strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_storage() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    EXCEL_DIR.mkdir(parents=True, exist_ok=True)

    conn = get_conn()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                row_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                incident_keywords TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def extract_rows_from_excel(file_path: Path) -> list[dict[str, Any]]:
    sheet_map = pd.read_excel(file_path, sheet_name=None, dtype=str)
    rows: list[dict[str, Any]] = []
    for sheet_name, df in sheet_map.items():
        cleaned_df = df.fillna("")
        for row in cleaned_df.to_dict(orient="records"):
            mapped: dict[str, Any] = {"__sheet": sheet_name}
            for key, value in row.items():
                mapped[str(key).strip()] = str(value).strip()
            rows.append(mapped)
    return rows


def get_incident_keywords(rows: list[dict[str, Any]]) -> list[str]:
    if not rows:
        return []

    first = rows[0]
    keys = [k for k in first.keys() if not k.startswith("__")]
    incident_key = None
    for key in keys:
        norm = normalize_text(key)
        if norm in {"su co", "suco"} or "su co" in norm:
            incident_key = key
            break

    if not incident_key:
        return []

    values = set()
    for row in rows:
        value = str(row.get(incident_key, "")).strip()
        if value:
            values.add(value)

    return sorted(values)[:200]


def row_to_document(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "fileName": row["file_name"],
        "storedPath": row["stored_path"],
        "rowCount": row["row_count"],
        "status": row["status"],
        "incidentKeywords": [x for x in row["incident_keywords"].split("|") if x],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def require_clients() -> tuple[QdrantClient, OllamaEmbeddings, ChatOllama]:
    if not qdrant_client or not embeddings_model or not chat_model:
        raise HTTPException(status_code=500, detail="RAG services are not initialized")
    return qdrant_client, embeddings_model, chat_model


def ensure_qdrant_collection(client: QdrantClient, embedder: OllamaEmbeddings) -> None:
    probe = embedder.embed_query("incident-response-healthcheck")
    vector_size = len(probe)

    collections = client.get_collections().collections
    if any(col.name == QDRANT_COLLECTION for col in collections):
        return

    client.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
    )


def build_row_text(row: dict[str, Any]) -> str:
    preferred_order = [
        "Sự cố",
        "Trường hợp",
        "Server",
        "Account",
        "Dấu hiện",
        "Cách xử lý",
        "Ngoại lệ",
    ]

    items: list[str] = []
    used = set()

    for key in preferred_order:
        if key in row and str(row[key]).strip():
            items.append(f"{key}: {str(row[key]).strip()}")
            used.add(key)

    for key, value in row.items():
        if key in used or key.startswith("__"):
            continue
        if str(value).strip():
            items.append(f"{key}: {str(value).strip()}")

    return " | ".join(items)


def index_document_to_qdrant(
    client: QdrantClient,
    embedder: OllamaEmbeddings,
    document_id: str,
    file_name: str,
    rows: list[dict[str, Any]],
) -> int:
    ensure_qdrant_collection(client, embedder)

    if not rows:
        return 0

    delete_filter = Filter(
        must=[FieldCondition(key="documentId", match=MatchAny(any=[document_id]))]
    )
    client.delete(collection_name=QDRANT_COLLECTION, points_selector=delete_filter)

    texts: list[str] = []
    metadatas: list[dict[str, Any]] = []
    for idx, row in enumerate(rows, start=1):
        text = build_row_text(row)
        if not text:
            continue
        texts.append(text)
        metadatas.append(
            {
                "documentId": document_id,
                "fileName": file_name,
                "rowIndex": idx,
                "sheetName": row.get("__sheet", "Sheet1"),
                "incident": str(row.get("Sự cố", "")).strip(),
                "sourceType": "excel-row",
            }
        )

    if not texts:
        return 0

    vectors = embedder.embed_documents(texts)
    points: list[PointStruct] = []
    for i, (text, metadata, vector) in enumerate(zip(texts, metadatas, vectors), start=1):
        points.append(
            PointStruct(
                id=f"{document_id}-{i}",
                vector=vector,
                payload={
                    "text": text,
                    **metadata,
                },
            )
        )

    client.upsert(collection_name=QDRANT_COLLECTION, points=points, wait=True)
    return len(points)


def search_context(
    client: QdrantClient,
    embedder: OllamaEmbeddings,
    question: str,
    selected_document_ids: list[str],
    use_all_documents: bool,
    limit: int = 8,
) -> list[Any]:
    ensure_qdrant_collection(client, embedder)

    query_vector = embedder.embed_query(question)

    query_filter = None
    if not use_all_documents and selected_document_ids:
        query_filter = Filter(
            must=[
                FieldCondition(
                    key="documentId",
                    match=MatchAny(any=selected_document_ids),
                )
            ]
        )

    return client.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=query_vector,
        query_filter=query_filter,
        limit=limit,
        with_payload=True,
    )


def load_document(document_id: str) -> sqlite3.Row:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document not found")
        return row
    finally:
        conn.close()


def recommend_documents_logic(question: str, top_k: int) -> list[dict[str, Any]]:
    norm_question = normalize_text(question)
    q_tokens = set(norm_question.split())

    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM documents ORDER BY created_at DESC").fetchall()
    finally:
        conn.close()

    scored: list[tuple[int, sqlite3.Row]] = []
    for row in rows:
        keywords = [x for x in row["incident_keywords"].split("|") if x]
        score = 0
        for kw in keywords:
            norm_kw = normalize_text(kw)
            if not norm_kw:
                continue
            if norm_kw in norm_question:
                score += 3
            kw_tokens = set(norm_kw.split())
            score += len(kw_tokens.intersection(q_tokens))
        scored.append((score, row))

    scored.sort(key=lambda item: (item[0], item[1]["created_at"]), reverse=True)
    selected = [row_to_document(item[1]) for item in scored[:top_k] if item[0] > 0]

    if not selected:
        fallback = [row_to_document(item[1]) for item in scored[:top_k]]
        return fallback
    return selected


class RecommendRequest(BaseModel):
    incident: str = Field(min_length=2)
    topK: int = Field(default=5, ge=1, le=20)


class ChatRequest(BaseModel):
    question: str = Field(min_length=2)
    sessionId: str | None = None
    useAllDocuments: bool = True
    selectedDocumentIds: list[str] = Field(default_factory=list)


@app.on_event("startup")
def startup() -> None:
    init_storage()
    global qdrant_client, embeddings_model, chat_model
    qdrant_client = QdrantClient(url=QDRANT_URL, timeout=30)
    embeddings_model = OllamaEmbeddings(model=OLLAMA_EMBED_MODEL, base_url=OLLAMA_BASE_URL)
    chat_model = ChatOllama(
        model=OLLAMA_CHAT_MODEL,
        base_url=OLLAMA_BASE_URL,
        temperature=0.1,
    )
    try:
        ensure_qdrant_collection(qdrant_client, embeddings_model)
    except Exception:
        # Ollama model pull may still be running; collection init will retry lazily.
        pass


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/documents")
def list_documents() -> dict[str, Any]:
    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM documents ORDER BY created_at DESC").fetchall()
    finally:
        conn.close()

    return {"documents": [row_to_document(row) for row in rows]}


@app.post("/api/documents/upload")
def upload_document(
    file: UploadFile = File(...),
    auto_index: bool = Query(default=True),
) -> dict[str, Any]:
    file_name = file.filename or "uploaded.xlsx"
    ext = Path(file_name).suffix.lower()
    if ext not in {".xlsx", ".xls"}:
        raise HTTPException(status_code=400, detail="Only .xlsx and .xls are supported")

    document_id = str(uuid4())
    stored_name = f"{document_id}{ext}"
    stored_path = EXCEL_DIR / stored_name

    try:
        content = file.file.read()
        stored_path.write_bytes(content)
        rows = extract_rows_from_excel(stored_path)
        keywords = get_incident_keywords(rows)
        row_count = len(rows)

        conn = get_conn()
        try:
            now = now_iso()
            conn.execute(
                """
                INSERT INTO documents(id, file_name, stored_path, row_count, status, incident_keywords, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    file_name,
                    str(stored_path),
                    row_count,
                    "uploaded",
                    "|".join(keywords),
                    now,
                    now,
                ),
            )
            conn.commit()
        finally:
            conn.close()

        indexing_result: dict[str, Any] = {"status": "skipped"}
        if auto_index:
            client, embedder, _ = require_clients()
            chunks = index_document_to_qdrant(client, embedder, document_id, file_name, rows)
            indexing_result = {"status": "indexed", "chunks": chunks}
            status_value = "indexed"

            conn = get_conn()
            try:
                conn.execute(
                    "UPDATE documents SET status = ?, updated_at = ? WHERE id = ?",
                    (status_value, now_iso(), document_id),
                )
                conn.commit()
            finally:
                conn.close()

        return {
            "id": document_id,
            "fileName": file_name,
            "rowCount": row_count,
            "status": indexing_result.get("status", "uploaded"),
            "indexResult": indexing_result,
        }
    except HTTPException:
        raise
    except Exception as exc:
        if stored_path.exists():
            stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}") from exc


@app.delete("/api/documents/{document_id}")
def delete_document(document_id: str) -> dict[str, Any]:
    row = load_document(document_id)
    stored_path = Path(row["stored_path"])

    conn = get_conn()
    try:
        conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
        conn.commit()
    finally:
        conn.close()

    if stored_path.exists():
        stored_path.unlink(missing_ok=True)

    client, _, _ = require_clients()
    delete_filter = Filter(
        must=[FieldCondition(key="documentId", match=MatchAny(any=[document_id]))]
    )
    client.delete(collection_name=QDRANT_COLLECTION, points_selector=delete_filter)

    return {"status": "deleted", "id": document_id}


@app.get("/api/documents/{document_id}/rows")
def get_document_rows(document_id: str) -> dict[str, Any]:
    row = load_document(document_id)
    file_path = Path(row["stored_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Stored file not found")

    rows = extract_rows_from_excel(file_path)
    return {
        "id": row["id"],
        "fileName": row["file_name"],
        "rowCount": len(rows),
        "rows": rows,
    }


@app.get("/api/documents/{document_id}/download")
def download_document(document_id: str) -> FileResponse:
    row = load_document(document_id)
    file_path = Path(row["stored_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Stored file not found")

    return FileResponse(
        path=file_path,
        filename=row["file_name"],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.post("/api/documents/recommend")
def recommend_documents(payload: RecommendRequest) -> dict[str, Any]:
    docs = recommend_documents_logic(payload.incident, payload.topK)
    return {"documents": docs}


@app.post("/api/chat")
def chat(payload: ChatRequest) -> dict[str, Any]:
    if not payload.useAllDocuments and not payload.selectedDocumentIds:
        raise HTTPException(status_code=400, detail="Select at least one document or choose all")

    recommended = recommend_documents_logic(payload.question, 5)
    try:
        client, embedder, llm = require_clients()
        hits = search_context(
            client=client,
            embedder=embedder,
            question=payload.question,
            selected_document_ids=payload.selectedDocumentIds,
            use_all_documents=payload.useAllDocuments,
            limit=8,
        )

        top_hits = hits[:6]
        context_blocks: list[str] = []
        sources: list[str] = []
        for idx, hit in enumerate(top_hits, start=1):
            payload_data = hit.payload or {}
            file_name = str(payload_data.get("fileName", "unknown"))
            row_index = payload_data.get("rowIndex", "?")
            text = str(payload_data.get("text", ""))
            context_blocks.append(f"[{idx}] ({file_name} - row {row_index}) {text}")
            sources.append(f"{file_name}#row:{row_index}")

        context = "\n\n".join(context_blocks)
        if not context:
            return {
                "answer": "Khong tim thay du lieu phu hop trong kho tai lieu. Hay thu chon tai lieu khac hoac upload bo tai lieu ung cuu su co.",
                "sources": [],
                "recommendedDocuments": recommended,
            }

        chain = rag_prompt | llm | StrOutputParser()
        answer = chain.invoke({"context": context, "question": payload.question})

        return {
            "answer": answer,
            "sources": sources,
            "recommendedDocuments": recommended,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Chat RAG error: {exc}") from exc
