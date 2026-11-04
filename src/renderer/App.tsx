import { useEffect } from 'react'
import { StopAllButton } from './components/StopAllButton'
import { ChatPanel } from './components/ChatPanel'
import { Composer } from './components/Composer'
import { ProfilePicker } from './components/ProfilePicker'
import { ProfilesScreen } from './components/ProfilesScreen'
import { SkillsScreen } from './components/SkillsScreen'
import { MuteButton } from './components/MuteButton'
import { Rail } from './components/Rail'
import { MascotsScreen } from './components/MascotsScreen'
import { useLookStore } from './state/lookStore'
import { VoicesScreen } from './components/VoicesScreen'
import { useVoiceStore } from './state/voiceStore'
import { useSkillStore } from './state/skillStore'
import { ProjectPicker } from './components/ProjectPicker'
import { useProfileStore } from './state/profileStore'
import { Stage } from './stage/Stage'
import { UpdateBanner } from './components/UpdateBanner'
import { UsagePanel } from './components/UsagePanel'
import { useRunStore } from './state/runStore'
import { startToolRefresh } from './state/toolRefresh'
import './styles.css'

export function App() {
  const { chat, receive, loadTools } = useRunStore()
  useEffect(() => window.time.onRunEvent(receive), [receive])
  useEffect(() => startToolRefresh(loadTools), [loadTools])
  const project = useRunStore(s => s.project)
  const { active, load, setProfiles, configOpen } = useProfileStore()
  const skillsOpen = useSkillStore(s => s.open)
  const { open: voicesOpen, notice: voiceNotice } = useVoiceStore()
  const mascotsOpen = useLookStore(s => s.open)
  useEffect(() => { void useLookStore.getState().load() }, [])
  // Perfil do projeto: carrega ao abrir o projeto e acompanha mudanças feitas na tela de perfis.
  useEffect(() => { if (project) void load(project.id) }, [project, load])
  useEffect(() => window.time.onProfiles(ps => { setProfiles(ps); if (project) void load(project.id) }), [project, load, setProfiles])
  const ids = new Set(active.agents.map(a => a.id))
  const busy = Object.entries(chat.agentStatus).filter(([id, s]) => ids.has(id) && (s === 'trabalhando' || s === 'esperando')).length
  const total = active.agents.length

  return (
    <div className="app">
      <Rail />
      <main className="stage">
        <div className="head">
          <h1>Tutti</h1>
          <div className="sub">{busy ? <><b>{busy} de {total}</b> trabalhando</> : <><b>{total} agentes</b>, todos disponíveis</>}</div>
          <div className="pickers"><ProjectPicker /><ProfilePicker /><UpdateBanner /><StopAllButton /><MuteButton /></div>
          {voiceNotice && <div className="voice-notice" role="status">{voiceNotice} <button className="link" onClick={() => useVoiceStore.setState({ notice: undefined })}>ok</button></div>}
        </div>
        <Stage />
        <UsagePanel />
        <Composer />
      </main>
      <ChatPanel />
      {configOpen && <ProfilesScreen />}
      {skillsOpen && <SkillsScreen />}
      {voicesOpen && <VoicesScreen />}
      {mascotsOpen && <MascotsScreen />}
    </div>
  )
}
