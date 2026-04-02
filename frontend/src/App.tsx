import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'

type ChatRole = 'user' | 'assistant'

type ChatMessage = {
  role: ChatRole
  text: string
}

type ChatResponse = {
  answer?: string
  sources?: string[]
}

type IngestResponse = {
  status?: string
  chunks?: number
  fileName?: string
}

type ViewMode = 'documents' | 'chat'

type IndexedDocument = {
  id: string
  fileName: string
  chunks: number
  uploadedAt: string
  status: string
}

const CHAT_WEBHOOK =
  import.meta.env.VITE_N8N_CHAT_WEBHOOK ?? 'http://localhost:5678/webhook/chat'
const INGEST_WEBHOOK =
  import.meta.env.VITE_N8N_INGEST_WEBHOOK ??
  'http://localhost:5678/webhook/ingest-excel'

function App() {
  const sessionId = useMemo(() => crypto.randomUUID(), [])
  const [viewMode, setViewMode] = useState<ViewMode>('documents')
  const [question, setQuestion] = useState('')
  const [uploadStatus, setUploadStatus] = useState('Chua tai file')
  const [loadingChat, setLoadingChat] = useState(false)
  const [documents, setDocuments] = useState<IndexedDocument[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: 'Xin chao, hay tai file Excel va dat cau hoi de bat dau RAG.',
    },
  ])

  const onUploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setUploadStatus('Dang upload va indexing...')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(INGEST_WEBHOOK, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Khong goi duoc ingest webhook')
      }

      const result = (await response.json()) as IngestResponse
      const chunkCount = result.chunks ?? 0
      setUploadStatus(`Da index ${chunkCount} chunks cho file ${file.name}`)
      setDocuments((prev) => [
        {
          id: crypto.randomUUID(),
          fileName: result.fileName ?? file.name,
          chunks: chunkCount,
          uploadedAt: new Date().toLocaleString('vi-VN'),
          status: result.status ?? 'indexed',
        },
        ...prev,
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setUploadStatus(`Upload loi: ${message}`)
    }
  }

  const removeDocument = (id: string) => {
    setDocuments((prev) => prev.filter((item) => item.id !== id))
  }

  const onAskQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = question.trim()
    if (!trimmed) {
      return
    }

    setQuestion('')
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }])
    setLoadingChat(true)

    try {
      const response = await fetch(CHAT_WEBHOOK, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: trimmed,
          sessionId,
        }),
      })

      if (!response.ok) {
        throw new Error('Khong goi duoc chat webhook')
      }

      const result = (await response.json()) as ChatResponse
      const answer = result.answer ?? 'Khong nhan duoc cau tra loi tu he thong.'
      const sources = result.sources && result.sources.length > 0
        ? `\nNguon: ${result.sources.join(', ')}`
        : ''

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `${answer}${sources}` },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `Loi ket noi: ${message}` },
      ])
    } finally {
      setLoadingChat(false)
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>RAG Console</h1>
          <p>React + n8n + Ollama + Qdrant</p>
        </div>
        <nav className="menu">
          <button
            className={viewMode === 'documents' ? 'menu-item active' : 'menu-item'}
            onClick={() => setViewMode('documents')}
            type="button"
          >
            Quan ly tai lieu
          </button>
          <button
            className={viewMode === 'chat' ? 'menu-item active' : 'menu-item'}
            onClick={() => setViewMode('chat')}
            type="button"
          >
            Hoi dap RAG
          </button>
        </nav>
      </aside>

      <section className="workspace">
        {viewMode === 'documents' && (
          <>
            <section className="panel upload-panel">
              <h2>Quan ly tai lieu cho RAG</h2>
              <p>
                Upload file Excel de n8n ingest, tao embedding va luu vao Qdrant.
                File goc nen luu tai /data/excel trong n8n de co the re-index.
              </p>
              <label className="file-btn">
                Chon file Excel
                <input type="file" accept=".xlsx,.xls" onChange={onUploadFile} />
              </label>
              <div className="status">{uploadStatus}</div>
            </section>

            <section className="panel">
              <h2>Danh sach tai lieu da index</h2>
              {documents.length === 0 ? (
                <p>Chua co tai lieu nao duoc index trong phien lam viec nay.</p>
              ) : (
                <div className="doc-list">
                  {documents.map((doc) => (
                    <article key={doc.id} className="doc-item">
                      <div>
                        <h3>{doc.fileName}</h3>
                        <p>Chunks: {doc.chunks}</p>
                        <p>Thoi gian: {doc.uploadedAt}</p>
                        <p>Trang thai: {doc.status}</p>
                      </div>
                      <button type="button" onClick={() => removeDocument(doc.id)}>
                        An khoi danh sach
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {viewMode === 'chat' && (
          <section className="panel chat-panel">
            <h2>Hoi dap voi tri thuc RAG</h2>
            <p className="chat-note">
              n8n se truy xuat tu Qdrant collection rag_docs de tao context tra loi.
            </p>
            <div className="message-list">
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`message ${message.role}`}>
                  {message.text}
                </div>
              ))}
            </div>

            <form onSubmit={onAskQuestion} className="chat-form">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Dat cau hoi tu tai lieu Excel da upload"
                disabled={loadingChat}
              />
              <button type="submit" disabled={loadingChat}>
                {loadingChat ? 'Dang tra loi...' : 'Hoi'}
              </button>
            </form>
          </section>
        )}
      </section>
    </main>
  )
}

export default App
