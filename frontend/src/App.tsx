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

const CHAT_WEBHOOK =
  import.meta.env.VITE_N8N_CHAT_WEBHOOK ?? 'http://localhost:5678/webhook/chat'
const INGEST_WEBHOOK =
  import.meta.env.VITE_N8N_INGEST_WEBHOOK ??
  'http://localhost:5678/webhook/ingest-excel'

function App() {
  const sessionId = useMemo(() => crypto.randomUUID(), [])
  const [question, setQuestion] = useState('')
  const [uploadStatus, setUploadStatus] = useState('Chua tai file')
  const [loadingChat, setLoadingChat] = useState(false)
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setUploadStatus(`Upload loi: ${message}`)
    }
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
    <main className="app">
      <header className="app-header">
        <h1>Local RAG Chatbot</h1>
        <p>React TSX + n8n + Ollama + Qdrant</p>
      </header>

      <section className="panel upload-panel">
        <h2>Upload Excel vao kho tri thuc</h2>
        <p>Ho tro .xlsx va .xls. n8n se tach du lieu, tao embedding va upsert vao Qdrant.</p>
        <label className="file-btn">
          Chon file Excel
          <input type="file" accept=".xlsx,.xls" onChange={onUploadFile} />
        </label>
        <div className="status">{uploadStatus}</div>
      </section>

      <section className="panel chat-panel">
        <h2>Chat voi du lieu da index</h2>
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
    </main>
  )
}

export default App
