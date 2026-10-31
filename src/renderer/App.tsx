import { useEffect } from 'react'
import { AGENTS } from '@shared/agents'
import { ChatPanel } from './components/ChatPanel'
import { Composer } from './components/Composer'
import { ProjectPicker } from './components/ProjectPicker'
import type { AgentStatus } from './state/chat'
import { useRunStore } from './state/runStore'
import './styles.css'

const LABEL: Record<AgentStatus, string> = { disponivel: 'Disponível', trabalhando: 'Trabalhando', esperando: 'Esperando você', concluido: 'Concluído' }
const TOOL = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'opencode' }

export function App() {
  const { chat, receive } = useRunStore()
  useEffect(() => window.time.onRunEvent(receive), [receive])
  const busy = Object.values(chat.agentStatus).filter(s => s === 'trabalhando' || s === 'esperando').length

  return (
    <div className="app">
      <nav className="rail"><div className="logo" /></nav>
      <main className="stage">
        <div className="head">
          <h1>Time</h1>
          <div className="sub">{busy ? <><b>{busy} de {AGENTS.length}</b> trabalhando</> : <><b>{AGENTS.length} agentes</b>, todos disponíveis</>}</div>
          <ProjectPicker />
        </div>
        {/* Placeholder do palco 3D (Fase 2) */}
        <div className="cast">
          {AGENTS.map(a => {
            const st = chat.agentStatus[a.id]
            return (
              <div key={a.id} className={`agent ${a.availableInPhase !== 1 ? 'later' : ''}`}>
                <div className={`avatar dot-${a.id}`} />
                <div className="nm">{a.nome}</div>
                <div className="tool">{TOOL[a.tool]}</div>
                <div className={`pill ${st}`}><i />{a.availableInPhase !== 1 ? 'Fase 3' : LABEL[st]}</div>
              </div>
            )
          })}
        </div>
        <Composer />
      </main>
      <ChatPanel />
    </div>
  )
}
