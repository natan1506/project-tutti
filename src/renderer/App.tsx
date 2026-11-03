import { useEffect } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { Composer } from './components/Composer'
import { ProfilePicker } from './components/ProfilePicker'
import { ProfilesScreen } from './components/ProfilesScreen'
import { SkillsScreen } from './components/SkillsScreen'
import { useSkillStore } from './state/skillStore'
import { ProjectPicker } from './components/ProjectPicker'
import { useProfileStore } from './state/profileStore'
import { Stage } from './stage/Stage'
import { UpdateBanner } from './components/UpdateBanner'
import { UsagePanel } from './components/UsagePanel'
import { useRunStore } from './state/runStore'
import { startToolRefresh } from './state/toolRefresh'
import icon from './assets/icon.png'
import './styles.css'

export function App() {
  const { chat, receive, loadTools } = useRunStore()
  useEffect(() => window.time.onRunEvent(receive), [receive])
  useEffect(() => startToolRefresh(loadTools), [loadTools])
  const project = useRunStore(s => s.project)
  const { active, load, setProfiles, configOpen } = useProfileStore()
  const skillsOpen = useSkillStore(s => s.open)
  // Perfil do projeto: carrega ao abrir o projeto e acompanha mudanças feitas na tela de perfis.
  useEffect(() => { if (project) void load(project.id) }, [project, load])
  useEffect(() => window.time.onProfiles(ps => { setProfiles(ps); if (project) void load(project.id) }), [project, load, setProfiles])
  const ids = new Set(active.agents.map(a => a.id))
  const busy = Object.entries(chat.agentStatus).filter(([id, s]) => ids.has(id) && (s === 'trabalhando' || s === 'esperando')).length
  const total = active.agents.length

  return (
    <div className="app">
      <nav className="rail"><img className="logo" src={icon} alt="Tutti" /></nav>
      <main className="stage">
        <div className="head">
          <h1>Tutti</h1>
          <div className="sub">{busy ? <><b>{busy} de {total}</b> trabalhando</> : <><b>{total} agentes</b>, todos disponíveis</>}</div>
          <div className="pickers"><ProjectPicker /><ProfilePicker /><UpdateBanner /></div>
        </div>
        <Stage />
        <UsagePanel />
        <Composer />
      </main>
      <ChatPanel />
      {configOpen && <ProfilesScreen />}
      {skillsOpen && <SkillsScreen />}
    </div>
  )
}
