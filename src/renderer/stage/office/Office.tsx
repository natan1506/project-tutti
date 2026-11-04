import { Html, RoundedBox, useTexture } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ACESFilmicToneMapping, type Group, type Mesh, type MeshStandardMaterial } from 'three'
import { AGENTS, type AgentDef, type AgentId } from '@shared/agents'
import icon from '../../assets/icon.png'
import { useLookStore } from '../../state/lookStore'
import { activeAgents, useProfileStore } from '../../state/profileStore'
import { useRunStore } from '../../state/runStore'
import { deriveStage, type MascotView, type Pose } from '../derive'
import { Bubble, MascotLabel } from '../Mascot'
import { MascotBody } from '../mascots'
import { motionFrame, type MotionFrame } from '../motion'
import { CanvasBoundary } from '../Stage'
import { coffeeMachine, coffeeSpot, deskSpot, meetingCenter, meetingSeat, pathBetween, type Spot } from './layout'
import { officeTargets, type Place, type TeamPhase } from './targets'

// Escritório 3D (design §7): a mesma informação do palco, contada por lugar e gesto.
// Identidade do Tutti: azul-marinho no piso e paredes, violeta→ciano nas luzes e detalhes.

const NAVY = '#15133a'
const WALL = '#1b1846'
const VIOLET = '#8b6cf6'
const CYAN = '#3fd8ee'
const SCALE = 0.62
const SPEED = 2.4
const SEAT = 0.75 // distância da cadeira até a mesa
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const SCREEN: Record<Pose, string> = { idle: '#2b2575', thinking: VIOLET, working: CYAN, waiting: '#f87171', done: '#3ecf8e', locked: '#0c0b1f' }

function Desk({ id, spot, pose, coordinator, name, onPhone }: { id: string; spot: Spot; pose: Pose; coordinator: boolean; name: string; onPhone(): void }) {
  const screen = useRef<MeshStandardMaterial>(null)
  const phone = useRef<Mesh>(null)
  const ringing = pose === 'waiting'
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (screen.current) screen.current.emissiveIntensity = pose === 'thinking' ? 0.6 + Math.sin(t * 4) * 0.4 : pose === 'locked' ? 0 : 1
    if (phone.current) {
      const m = phone.current.material as MeshStandardMaterial
      m.emissiveIntensity = ringing ? (Math.floor(t * 4) % 2 ? 1.6 : 0.2) : 0
      phone.current.rotation.z = ringing && !reducedMotion() ? Math.sin(t * 30) * 0.12 : 0
    }
  })
  return (
    <group name={`desk-${id}`} position={[spot.x, 0, spot.z - SEAT]}>
      <RoundedBox args={[1.7, 0.08, 0.9]} radius={0.03} position={[0, 0.72, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={coordinator ? '#2a2462' : '#221e52'} roughness={0.6} />
      </RoundedBox>
      {[-0.75, 0.75].map(x => <mesh key={x} position={[x, 0.36, 0]} castShadow><boxGeometry args={[0.06, 0.72, 0.8]} /><meshStandardMaterial color="#120f2e" /></mesh>)}
      {/* Monitor virado para o mascote e para a câmera atrás dele. */}
      <mesh position={[0, 1.12, -0.25]} castShadow><boxGeometry args={[0.9, 0.55, 0.05]} /><meshStandardMaterial color="#0a091b" /></mesh>
      <mesh position={[0, 1.12, -0.22]}><planeGeometry args={[0.82, 0.47]} />
        <meshStandardMaterial ref={screen} color="#0c0b1f" emissive={SCREEN[pose]} emissiveIntensity={1} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.82, -0.25]}><boxGeometry args={[0.08, 0.16, 0.05]} /><meshStandardMaterial color="#0a091b" /></mesh>
      <mesh position={[0, 0.77, 0.12]}><boxGeometry args={[0.6, 0.02, 0.18]} /><meshStandardMaterial color="#2f2b63" /></mesh>
      <mesh ref={phone} name={`phone-${id}`} userData={{ ringing }} position={[0.6, 0.79, 0.05]}
        onClick={e => { e.stopPropagation(); onPhone() }}>
        <boxGeometry args={[0.2, 0.06, 0.14]} /><meshStandardMaterial color="#3a3478" emissive="#f87171" emissiveIntensity={0} />
      </mesh>
      <mesh position={[-0.6, 0.82, 0.12]}><cylinderGeometry args={[0.05, 0.045, 0.12, 16]} /><meshStandardMaterial color={CYAN} roughness={0.3} /></mesh>
      {/* Cadeira: a do coordenador tem encosto mais alto. */}
      <group position={[0, 0, SEAT]}>
        <mesh position={[0, 0.3, 0]} castShadow><cylinderGeometry args={[0.34, 0.34, 0.08, 24]} /><meshStandardMaterial color={coordinator ? VIOLET : '#2f2b63'} /></mesh>
        <mesh position={[0, 0.15, 0]}><cylinderGeometry args={[0.05, 0.05, 0.3, 8]} /><meshStandardMaterial color="#120f2e" /></mesh>
      </group>
      {pose === 'locked' && (
        <Html position={[0, 1.6, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className="nameplate off">{name} · indisponível</div>
        </Html>
      )}
    </group>
  )
}

function Room({ headless }: { headless: boolean }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[24, 14]} /><meshStandardMaterial color={NAVY} roughness={0.9} /></mesh>
      <mesh position={[0, 2, -7]} receiveShadow><boxGeometry args={[24, 4, 0.2]} /><meshStandardMaterial color={WALL} /></mesh>
      <mesh position={[-12, 2, 0]} receiveShadow><boxGeometry args={[0.2, 4, 14]} /><meshStandardMaterial color={WALL} /></mesh>
      {/* Faixa de luz violeta→ciano no rodapé. */}
      <mesh position={[0, 0.05, -6.88]}><boxGeometry args={[24, 0.05, 0.02]} /><meshBasicMaterial color={VIOLET} toneMapped={false} /></mesh>
      <mesh position={[-11.88, 0.05, 0]}><boxGeometry args={[0.02, 0.05, 14]} /><meshBasicMaterial color={CYAN} toneMapped={false} /></mesh>
      {!headless && <Suspense fallback={null}><Logo /></Suspense>}
      {/* Mesa de reunião redonda. */}
      <group position={[meetingCenter().x, 0, meetingCenter().z]} name="meeting-table">
        <mesh position={[0, 0.72, 0]} castShadow receiveShadow><cylinderGeometry args={[1.0, 1.0, 0.08, 40]} /><meshStandardMaterial color="#2a2462" /></mesh>
        <mesh position={[0, 0.36, 0]}><cylinderGeometry args={[0.12, 0.2, 0.72, 16]} /><meshStandardMaterial color="#120f2e" /></mesh>
      </group>
      {/* Café: máquina e dois banquinhos. */}
      <group position={[coffeeMachine().x, 0, coffeeMachine().z]} name="coffee">
        <mesh position={[0, 0.5, -0.3]} castShadow><boxGeometry args={[1.4, 1, 0.6]} /><meshStandardMaterial color="#221e52" /></mesh>
        <mesh position={[0, 1.25, -0.35]} castShadow><boxGeometry args={[0.45, 0.5, 0.4]} /><meshStandardMaterial color="#0a091b" /></mesh>
        <mesh position={[0, 1.35, -0.14]}><boxGeometry args={[0.2, 0.06, 0.02]} /><meshBasicMaterial color={CYAN} toneMapped={false} /></mesh>
        {[-0.8, 0.8].map(x => <mesh key={x} position={[x, 0.35, 0.7]} castShadow><cylinderGeometry args={[0.22, 0.18, 0.7, 20]} /><meshStandardMaterial color={VIOLET} /></mesh>)}
      </group>
      {/* Plantas e um quadro. */}
      {[[-10.8, -6], [10.8, -6], [10.8, 5.5]].map(([x, z]) => (
        <group key={`${x},${z}`} position={[x, 0, z]}>
          <mesh position={[0, 0.25, 0]} castShadow><cylinderGeometry args={[0.28, 0.22, 0.5, 16]} /><meshStandardMaterial color="#2f2b63" /></mesh>
          <mesh position={[0, 0.85, 0]} castShadow><sphereGeometry args={[0.45, 16, 12]} /><meshStandardMaterial color="#3ecf8e" roughness={0.8} /></mesh>
        </group>
      ))}
      <mesh position={[6, 2.2, -6.88]}><planeGeometry args={[2.4, 1.4]} /><meshStandardMaterial color="#3a3478" emissive="#3fd8ee" emissiveIntensity={0.08} /></mesh>
    </group>
  )
}

function Logo() {
  const tex = useTexture(icon)
  return (
    <group position={[-3, 2.4, -6.88]}>
      <mesh><planeGeometry args={[1.4, 1.4]} /><meshBasicMaterial map={tex} transparent toneMapped={false} /></mesh>
      <pointLight position={[0, 0, 0.8]} intensity={4} distance={4} color={VIOLET} />
    </group>
  )
}

/** Mascote que anda até o lugar pedido pelo estado (mesa, reunião ou café), virando para onde vai. */
function OfficeMascot({ agent, view, home, place, onSelect, labels, portal }: {
  agent: AgentDef; view: MascotView; home: { desk: Spot; meeting: Spot }; place: Place; onSelect(id: AgentId): void; labels: boolean
  portal?: RefObject<HTMLElement | null>
}) {
  const g = useRef<Group>(null)
  const body = useRef<Group>(null)
  const frame = useRef<MotionFrame>(motionFrame(view.pose, 0, 0, 0))
  const t = useRef(0)
  const path = useRef<Spot[]>([])
  const pos = useRef<Spot>({ ...home.desk })
  const look = useLookStore(s => s.looks[agent.id])
  const target = place === 'meeting' ? home.meeting : place === 'coffee' ? coffeeSpot() : home.desk
  const locked = view.pose === 'locked'

  useEffect(() => {
    if (reducedMotion()) { pos.current = { ...target }; path.current = []; return }
    path.current = pathBetween(pos.current, target).slice(1)
  }, [target.x, target.z])

  useFrame(({ clock }, dt) => {
    t.current = clock.elapsedTime
    const walking = path.current.length > 0
    frame.current = motionFrame(walking ? 'working' : view.pose, t.current, agent.id.length, 0, { defaultExpression: look?.eyes, reduced: reducedMotion() })
    if (walking) {
      const next = path.current[0]
      const dx = next.x - pos.current.x, dz = next.z - pos.current.z
      const d = Math.hypot(dx, dz)
      const step = Math.min(d, SPEED * Math.min(dt, 0.1))
      if (d < 1e-3) path.current.shift()
      else {
        pos.current = { x: pos.current.x + (dx / d) * step, z: pos.current.z + (dz / d) * step }
        if (body.current) body.current.rotation.y = Math.atan2(dx, dz)
      }
    } else if (body.current) {
      // Na mesa fica de costas para a câmera, olhando o monitor; esperando ou concluído, vira para a câmera.
      const atDesk = place === 'desk'
      const face = !atDesk || view.pose === 'waiting' || view.pose === 'done' ? 0 : Math.PI
      body.current.rotation.y += (face - body.current.rotation.y) * Math.min(1, dt * 6)
    }
    if (g.current) g.current.position.set(pos.current.x, 0, pos.current.z)
  })

  if (locked) return <group name={`office-mascot-${agent.id}`} position={[home.desk.x, 0, home.desk.z]} visible={false} />
  return (
    <group ref={g} name={`office-mascot-${agent.id}`} position={[home.desk.x, 0, home.desk.z]}>
      <group ref={body} scale={SCALE} position={[0, 0.62 * SCALE + (place === 'desk' ? 0.34 : 0), 0]}
        onClick={e => { e.stopPropagation(); onSelect(agent.id) }}
        onPointerOver={() => { document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
        <MascotBody agentId={agent.id} look={look} frame={frame} t={t} />
      </group>
      {labels && (
        <>
          <Html position={[0, 1.9, 0]} zIndexRange={[20, 10]} portal={portal as RefObject<HTMLElement>} style={{ pointerEvents: 'none' }}><Bubble view={view} /></Html>
          <Html center position={[0, 0, 1.05]} zIndexRange={[10, 0]} portal={portal as RefObject<HTMLElement>}>
            <div className="office-tag"><MascotLabel id={agent.id} view={view} onSelect={() => onSelect(agent.id)} /></div>
          </Html>
        </>
      )}
    </group>
  )
}

function OfficeCamera() {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    // Sala inteira na tela: janela mais estreita afasta a câmera.
    const far = Math.max(1, 1.75 / (size.width / size.height))
    camera.position.set(3 * far, 15 * far, 17 * far)
    camera.lookAt(0, 0, -0.6)
    camera.updateProjectionMatrix()
  }, [camera, size])
  return null
}

/** `headless` desliga rótulos HTML e texturas (testes). */
export function OfficeScene({ views, selected, onSelect, headless = false, portal, agents = AGENTS, team, coffeeAgent }: {
  agents?: readonly AgentDef[]; views: Record<AgentId, MascotView>; selected: AgentId | 'time'; onSelect(id: AgentId): void
  headless?: boolean; portal?: RefObject<HTMLElement | null>; team?: TeamPhase; coffeeAgent?: string
}) {
  const ids = agents.map(a => a.id)
  const targets = officeTargets(ids, views, team, coffeeAgent)
  const seatsTaken = ids.filter(id => targets[id] === 'meeting')
  const busy = ids.filter(id => ['working', 'thinking', 'waiting'].includes(views[id]?.pose)).length
  const waiting = ids.filter(id => views[id]?.pose === 'waiting').length
  const off = ids.filter(id => views[id]?.pose === 'locked').length
  return (
    <>
      <OfficeCamera />
      <hemisphereLight args={['#e9e6ff', '#151238', 1.1]} />
      <directionalLight position={[6, 12, 8]} intensity={2.2} color="#fff1e6" castShadow shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={10} shadow-camera-bottom={-10} />
      <pointLight position={[0, 3.5, 0]} intensity={8} distance={14} color={VIOLET} />
      <Room headless={headless} />
      {!headless && (
        <Html position={[-8.4, 2.8, -6.85]} center zIndexRange={[4, 0]} portal={portal as RefObject<HTMLElement>}>
          <div className="team-panel"><b>Time</b><span>{busy} ocupados · {ids.length - busy - off} livres</span>{waiting > 0 && <em>{waiting} esperando você</em>}</div>
        </Html>
      )}
      {agents.map((a, i) => {
        const desk = deskSpot(i, agents.length)
        return (
          <group key={a.id}>
            <Desk id={a.id} spot={desk} pose={views[a.id]?.pose ?? 'idle'} coordinator={a.coordinator} name={a.nome} onPhone={() => onSelect(a.id)} />
            <OfficeMascot agent={a} view={views[a.id]} place={targets[a.id]}
              home={{ desk, meeting: meetingSeat(Math.max(0, seatsTaken.indexOf(a.id)), Math.max(seatsTaken.length, 1)) }}
              onSelect={onSelect} labels={!headless} portal={portal} />
            {selected === a.id && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[desk.x, 0.01, desk.z]}><ringGeometry args={[0.5, 0.58, 40]} /><meshBasicMaterial color={VIOLET} transparent opacity={0.5} /></mesh>
            )}
          </group>
        )
      })}
    </>
  )
}

/** Fase de reunião do Time: triagem, confirmação ou plano esperando (design §7.3). */
function teamPhase(chat: ReturnType<typeof useRunStore.getState>['chat'], ids: string[]): TeamPhase | undefined {
  const team = chat.runs.filter(r => r.team && r.status === 'running' && r.queued === undefined).at(-1)
  if (!team) return undefined
  const planPending = team.plan && team.plan.approved === undefined
  if (team.lineup && !planPending) return undefined
  const participants = team.triage?.candidates.length ? [team.agentId, ...team.triage.candidates] : ids
  return { phase: 'meeting', participants: [...new Set(participants)] }
}

export function Office() {
  const { chat, selectedAgent, selectAgent, tools } = useRunStore()
  const { active, status } = useProfileStore()
  const agents = useMemo(() => activeAgents(active), [active])
  const [now, setNow] = useState(() => Date.now())
  const [coffee, setCoffee] = useState<string>()
  const [lost, setLost] = useState(0)
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id) }, [])
  const views = useMemo(() => deriveStage(chat, now, tools, agents, status), [chat, now, tools, agents, status])
  const team = teamPhase(chat, agents.map(a => a.id))
  // De vez em quando, um agente livre vai ao café e volta (no máximo um por vez, a cada 1–3 min).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => {
        const free = agents.filter(a => views[a.id]?.pose === 'idle')
        const pick = free[Math.floor(Math.random() * free.length)]
        if (pick) { setCoffee(pick.id); timer = setTimeout(() => { setCoffee(undefined); schedule() }, 12_000) } else schedule()
      }, 60_000 + Math.random() * 120_000)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [agents])
  const overlay = useRef<HTMLDivElement>(null)
  // Contexto WebGL perdido: recria a cena (até 3 vezes); depois disso, pede para voltar ao Palco.
  if (lost > 3) return <div className="office-off">O escritório 3D não abriu nesta máquina. Volte para o Palco.</div>
  return (
    <div className="stage-3d office">
      <CanvasBoundary key={lost} onError={() => setLost(n => n + 1)}>
        <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 34, position: [3, 15, 17] }} gl={{ alpha: true, antialias: true, toneMapping: ACESFilmicToneMapping, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); console.warn('escritório: contexto WebGL perdido'); setLost(n => n + 1) })}>
          <OfficeScene views={views} selected={selectedAgent} onSelect={selectAgent} portal={overlay} agents={agents} team={team} coffeeAgent={coffee} />
        </Canvas>
      </CanvasBoundary>
      <div className="stage-overlay" ref={overlay} />
    </div>
  )
}
