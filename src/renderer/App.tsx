import { useEffect } from 'react'
import { AGENTS } from '@shared/agents'
import { ChatPanel } from './components/ChatPanel'
import { Composer } from './components/Composer'
import { ProjectPicker } from './components/ProjectPicker'
import { Stage } from './stage/Stage'
import { useRunStore } from './state/runStore'
import icon from './assets/icon.png'
import './styles.css'

export function App() {
  const { chat, receive, loadTools } = useRunStore()
  useEffect(() => window.time.onRunEvent(receive), [receive])
  useEffect(() => { void loadTools() }, [loadTools])
  const busy = Object.values(chat.agentStatus).filter(s => s === 'trabalhando' || s === 'esperando').length

  return (
    <div className="app">
      <nav className="rail"><img className="logo" src={icon} alt="Tutti" /></nav>
      <main className="stage">
        <div className="head">
          <h1>Tutti</h1>
          <div className="sub">{busy ? <><b>{busy} de {AGENTS.length}</b> trabalhando</> : <><b>{AGENTS.length} agentes</b>, todos disponíveis</>}</div>
          <ProjectPicker />
        </div>
        <Stage />
        <Composer />
      </main>
      <ChatPanel />
    </div>
  )
}
