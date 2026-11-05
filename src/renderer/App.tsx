import { Suspense, lazy, useEffect } from 'react'
import { StopAllButton } from './components/StopAllButton'
import { ChatPanel } from './components/ChatPanel'
import { Composer } from './components/Composer'
import { ProfilePicker } from './components/ProfilePicker'
import { ProfilesScreen } from './components/ProfilesScreen'
import { SkillsScreen } from './components/SkillsScreen'
import { MuteButton } from './components/MuteButton'
import { Rail } from './components/Rail'
import { ViewToggle } from './components/ViewToggle'
import { hasWebGL } from './stage/webgl'
import { useViewStore } from './state/viewStore'
import { useLookStore } from './state/lookStore'
import { VoicesScreen } from './components/VoicesScreen'
import { useVoiceStore } from './state/voiceStore'
import { useSkillStore } from './state/skillStore'
import { ProjectPicker } from './components/ProjectPicker'
import { useProfileStore } from './state/profileStore'
import { UpdateBanner } from './components/UpdateBanner'
import { UsagePanel } from './components/UsagePanel'
import { useRunStore } from './state/runStore'
import { createEventBatcher } from './state/eventBatcher'
import { startToolRefresh } from './state/toolRefresh'
import './styles.css'

// O 3D (three.js) é a maior parte do pacote: carrega à parte para o app abrir antes.
const Stage = lazy(() => import('./stage/Stage').then(m => ({ default: m.Stage })))
const Office = lazy(() => import('./stage/office/Office').then(m => ({ default: m.Office })))
const MascotsScreen = lazy(() => import('./components/MascotsScreen').then(m => ({ default: m.MascotsScreen })))

export function App() {
  const receiveMany = useRunStore(s => s.receiveMany)
  const loadTools = useRunStore(s => s.loadTools)
  const agentStatus = useRunStore(s => s.chat.agentStatus)
  useEffect(() => {
    const batch = createEventBatcher(receiveMany)
    const off = window.time.onRunEvent(batch.push)
    return () => { off(); batch.stop() }
  }, [receiveMany])
  useEffect(() => startToolRefresh(loadTools), [loadTools])
  const project = useRunStore(s => s.project)
  const { active, load, setProfiles, configOpen } = useProfileStore()
  const skillsOpen = useSkillStore(s => s.open)
  const { open: voicesOpen, notice: voiceNotice } = useVoiceStore()
  const mascotsOpen = useLookStore(s => s.open)
  const view = useViewStore(s => s.view)
  useEffect(() => { void useLookStore.getState().load() }, [])
  // Perfil do projeto: carrega ao abrir o projeto e acompanha mudanças feitas na tela de perfis.
  useEffect(() => { if (project) void load(project.id) }, [project, load])
  useEffect(() => window.time.onProfiles(ps => { setProfiles(ps); if (project) void load(project.id) }), [project, load, setProfiles])
  const ids = new Set(active.agents.map(a => a.id))
  const busy = Object.entries(agentStatus).filter(([id, s]) => ids.has(id) && (s === 'trabalhando' || s === 'esperando')).length
  const total = active.agents.length

  return (
    <div className="app">
      <div className="titlebar" />
      <Rail />
      <main className="stage">
        <div className="head">
          <h1>Tutti</h1>
          <div className="sub">{busy ? <><b>{busy} de {total}</b> trabalhando</> : <><b>{total} agentes</b>, todos disponíveis</>}</div>
          <div className="pickers"><ProjectPicker /><ProfilePicker /><UpdateBanner />{hasWebGL() && <ViewToggle />}<StopAllButton /><MuteButton /></div>
          {voiceNotice && <div className="voice-notice" role="status">{voiceNotice} <button className="link" onClick={() => useVoiceStore.setState({ notice: undefined })}>ok</button></div>}
        </div>
        <Suspense fallback={<div className="stage-3d" />}>{view === 'escritorio' && hasWebGL() ? <Office /> : <Stage />}</Suspense>
        <UsagePanel />
        <Composer />
      </main>
      <ChatPanel />
      {configOpen && <ProfilesScreen />}
      {skillsOpen && <SkillsScreen />}
      {voicesOpen && <VoicesScreen />}
      {mascotsOpen && <Suspense fallback={null}><MascotsScreen /></Suspense>}
    </div>
  )
}
