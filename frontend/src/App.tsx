import { useMemo, useState } from 'react'
import { useEffect } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'

type ChatRole = 'user' | 'assistant'

type ChatMessage = {
  role: ChatRole
  text: string
}

type IngestResponse = {
  id: string
  status: string
  fileName: string
  rowCount: number
  indexResult?: {
    status?: string
    chunks?: number
  }
}

type ViewMode = 'documents' | 'chat'

type IndexedDocument = {
  id: string
  fileName: string
  rowCount: number
  createdAt: string
  updatedAt: string
  status: string
  incidentKeywords: string[]
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

type RecommendResponse = {
  documents: IndexedDocument[]
}

type BackendChatResponse = {
  answer?: string
  sources?: string[]
  recommendedDocuments?: IndexedDocument[]
}

function App() {
  const sessionId = useMemo(() => crypto.randomUUID(), [])
  const [viewMode, setViewMode] = useState<ViewMode>('documents')
  const [question, setQuestion] = useState('')
  const [uploadStatus, setUploadStatus] = useState('Chua tai file')
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [loadingChat, setLoadingChat] = useState(false)
  const [documents, setDocuments] = useState<IndexedDocument[]>([])
  const [recommendedDocs, setRecommendedDocs] = useState<IndexedDocument[]>([])
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [useAllDocs, setUseAllDocs] = useState(true)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: 'Xin chao, hay tai file Excel va dat cau hoi de bat dau RAG.',
    },
  ])

  const loadDocuments = async () => {
    setLoadingDocs(true)
    try {
      const response = await fetch(`${API_BASE}/api/documents`)
      if (!response.ok) {
        throw new Error('Khong lay duoc danh sach tai lieu')
      }
      const data = (await response.json()) as { documents: IndexedDocument[] }
      setDocuments(data.documents || [])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setUploadStatus(`Tai danh sach loi: ${message}`)
    } finally {
      setLoadingDocs(false)
    }
  }

  useEffect(() => {
    void loadDocuments()
  }, [])

  const onUploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setUploadStatus('Dang upload va indexing...')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(`${API_BASE}/api/documents/upload?auto_index=true`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'Khong goi duoc backend upload')
      }

      const result = (await response.json()) as IngestResponse
      const chunks = result.indexResult?.chunks ?? result.rowCount
      setUploadStatus(`Da xu ly ${chunks} dong/chunk cho file ${result.fileName}`)
      await loadDocuments()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setUploadStatus(`Upload loi: ${message}`)
    }
  }

  const removeDocument = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/documents/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error('Khong xoa duoc tai lieu')
      }
      setDocuments((prev) => prev.filter((item) => item.id !== id))
      setRecommendedDocs((prev) => prev.filter((item) => item.id !== id))
      setSelectedDocIds((prev) => prev.filter((docId) => docId !== id))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setUploadStatus(`Xoa tai lieu loi: ${message}`)
    }
  }

  const reindexDocument = async (id: string) => {
    setUploadStatus('Dang re-index tai lieu...')
    try {
      const response = await fetch(`${API_BASE}/api/documents/${id}/reindex`, {
        method: 'POST',
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'Khong re-index duoc tai lieu')
      }

      await loadDocuments()
      setUploadStatus('Re-index thanh cong')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setUploadStatus(`Re-index loi: ${message}`)
    }
  }

  const suggestDocuments = async () => {
    const incident = question.trim()
    if (!incident) {
      return
    }

    try {
      const response = await fetch(`${API_BASE}/api/documents/recommend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          incident,
          topK: 5,
        }),
      })
      if (!response.ok) {
        throw new Error('Khong goi duoc API goi y tai lieu')
      }

      const data = (await response.json()) as RecommendResponse
      setRecommendedDocs(data.documents || [])
      setUseAllDocs(false)
      setSelectedDocIds((data.documents || []).map((doc) => doc.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `Khong goi y duoc tai lieu: ${message}` },
      ])
    }
  }

  const toggleSelectedDoc = (docId: string) => {
    setSelectedDocIds((prev) => {
      if (prev.includes(docId)) {
        return prev.filter((id) => id !== docId)
      }
      return [...prev, docId]
    })
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
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: trimmed,
          sessionId,
          useAllDocuments: useAllDocs,
          selectedDocumentIds: selectedDocIds,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'Khong goi duoc backend chat')
      }

      const result = (await response.json()) as BackendChatResponse
      const answer = result.answer ?? 'Khong nhan duoc cau tra loi tu he thong.'
      const sources = result.sources && result.sources.length > 0
        ? `\nNguon: ${result.sources.join(', ')}`
        : ''

      if (result.recommendedDocuments && result.recommendedDocuments.length > 0) {
        setRecommendedDocs(result.recommendedDocuments)
      }

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
          <p>React + LangChain API + Ollama + Qdrant</p>
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
                Upload file Excel vao backend. Backend luu kho tai lieu va index truc tiep
                vao Qdrant bang LangChain de phuc vu RAG.
              </p>
              <label className="file-btn">
                Chon file Excel
                <input type="file" accept=".xlsx,.xls" onChange={onUploadFile} />
              </label>
              <div className="status">{uploadStatus} {loadingDocs ? '(dang dong bo...)' : ''}</div>
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
                        <p>Rows: {doc.rowCount}</p>
                        <p>Thoi gian: {doc.createdAt}</p>
                        <p>Trang thai: {doc.status}</p>
                        {doc.incidentKeywords && doc.incidentKeywords.length > 0 && (
                          <p>Su co mau: {doc.incidentKeywords.slice(0, 4).join(', ')}</p>
                        )}
                      </div>
                      <div className="doc-actions">
                        <button type="button" onClick={() => reindexDocument(doc.id)}>
                          Re-index
                        </button>
                        <button type="button" onClick={() => removeDocument(doc.id)}>
                          Xoa tai lieu
                        </button>
                      </div>
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
              Dat cau hoi su co. He thong co the goi y tai lieu ung cuu phu hop,
              hoac ban co the chon doc tat ca.
            </p>

            <div className="recommend-tools">
              <button type="button" onClick={suggestDocuments} className="secondary-btn">
                Goi y tai lieu theo su co
              </button>
              <label className="check-all">
                <input
                  type="checkbox"
                  checked={useAllDocs}
                  onChange={(event) => setUseAllDocs(event.target.checked)}
                />
                Dung tat ca tai lieu
              </label>
            </div>

            {!useAllDocs && recommendedDocs.length > 0 && (
              <div className="recommend-list">
                {recommendedDocs.map((doc) => (
                  <label key={doc.id} className="recommend-item">
                    <input
                      type="checkbox"
                      checked={selectedDocIds.includes(doc.id)}
                      onChange={() => toggleSelectedDoc(doc.id)}
                    />
                    <span>{doc.fileName}</span>
                  </label>
                ))}
              </div>
            )}

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
