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
import { Bubble } from '../Mascot'
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
const SCALE = 0.85
const SPEED = 2.4
const SEAT = 0.75 // distância da cadeira até a mesa
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const SCREEN: Record<Pose, string> = { idle: '#2b2575', thinking: VIOLET, working: CYAN, waiting: '#f87171', done: '#3ecf8e', locked: '#0c0b1f' }
/** A mesa fica na frente do mascote (entre ele e a câmera); ele trabalha de frente para nós. */
const DESK_OFF = 0.85

function Desk({ id, spot, pose, coordinator, name, onPhone }: { id: string; spot: Spot; pose: Pose; coordinator: boolean; name: string; onPhone(): void }) {
  const screen = useRef<MeshStandardMaterial>(null)
  const phone = useRef<Mesh>(null)
  const ringing = pose === 'waiting'
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (screen.current) screen.current.emissiveIntensity = pose === 'thinking' ? 0.7 + Math.sin(t * 4) * 0.4 : pose === 'locked' ? 0 : 1.1
    if (phone.current) {
      const m = phone.current.material as MeshStandardMaterial
      m.emissiveIntensity = ringing ? (Math.floor(t * 4) % 2 ? 1.8 : 0.2) : 0
      phone.current.rotation.z = ringing && !reducedMotion() ? Math.sin(t * 30) * 0.14 : 0
    }
  })
  const wood = coordinator ? '#3a3080' : '#2a2462'
  return (
    <group name={`desk-${id}`} position={[spot.x, 0, spot.z + DESK_OFF]}>
      {/* Tampo baixo e painel frontal: o mascote aparece por cima. */}
      <RoundedBox args={[1.9, 0.07, 0.7]} radius={0.03} position={[0, 0.42, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={wood} roughness={0.55} />
      </RoundedBox>
      <mesh position={[0, 0.385, 0.355]}><boxGeometry args={[1.9, 0.015, 0.01]} /><meshBasicMaterial color={coordinator ? VIOLET : CYAN} toneMapped={false} /></mesh>
      {[-0.88, 0.88].map(x => <mesh key={x} position={[x, 0.21, 0]} castShadow><boxGeometry args={[0.05, 0.42, 0.64]} /><meshStandardMaterial color="#120f2e" /></mesh>)}
      {/* Monitor de lado, virado meio para a câmera: dá para ver a tela e o mascote ao mesmo tempo. */}
      <group position={[0.72, 0.455, -0.1]} rotation={[0, -0.85, 0]} scale={0.85}>
        <mesh position={[0, 0.34, 0]} castShadow><boxGeometry args={[0.72, 0.46, 0.04]} /><meshStandardMaterial color="#0a091b" roughness={0.4} /></mesh>
        <mesh position={[0, 0.34, 0.025]}><planeGeometry args={[0.66, 0.4]} />
          <meshStandardMaterial ref={screen} color="#0c0b1f" emissive={SCREEN[pose]} emissiveIntensity={1} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.08, 0]}><boxGeometry args={[0.06, 0.14, 0.04]} /><meshStandardMaterial color="#0a091b" /></mesh>
        <mesh position={[0, 0.015, 0]}><boxGeometry args={[0.26, 0.02, 0.16]} /><meshStandardMaterial color="#0a091b" /></mesh>
      </group>
      <mesh position={[0, 0.47, -0.12]}><boxGeometry args={[0.55, 0.02, 0.17]} /><meshStandardMaterial color="#3a3478" /></mesh>
      <mesh ref={phone} name={`phone-${id}`} userData={{ ringing }} position={[-0.62, 0.48, 0.08]}
        onClick={e => { e.stopPropagation(); onPhone() }}>
        <boxGeometry args={[0.22, 0.06, 0.15]} /><meshStandardMaterial color="#3a3478" emissive="#f87171" emissiveIntensity={0} />
      </mesh>
      <mesh position={[-0.3, 0.51, 0.12]}><cylinderGeometry args={[0.05, 0.045, 0.12, 16]} /><meshStandardMaterial color={CYAN} roughness={0.3} /></mesh>
      {/* Cadeira atrás do mascote; a do coordenador tem encosto alto e violeta. */}
      <group position={[0, 0, -DESK_OFF - 0.35]}>
        <mesh position={[0, 0.32, 0]} castShadow><cylinderGeometry args={[0.34, 0.34, 0.07, 24]} /><meshStandardMaterial color={coordinator ? VIOLET : '#2f2b63'} /></mesh>
        <mesh position={[0, coordinator ? 0.95 : 0.78, -0.3]} castShadow><boxGeometry args={[0.62, coordinator ? 1.1 : 0.8, 0.07]} /><meshStandardMaterial color={coordinator ? VIOLET : '#2f2b63'} /></mesh>
        <mesh position={[0, 0.16, 0]}><cylinderGeometry args={[0.05, 0.05, 0.3, 8]} /><meshStandardMaterial color="#120f2e" /></mesh>
      </group>
      {pose === 'locked' && (
        <Html position={[0, 1.4, -DESK_OFF]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className="nameplate off">{name} · indisponível</div>
        </Html>
      )}
    </group>
  )
}

function Plant({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, 0.3, 0]} castShadow><cylinderGeometry args={[0.3, 0.24, 0.6, 18]} /><meshStandardMaterial color="#2f2b63" /></mesh>
      <mesh position={[0, 0.95, 0]} castShadow><sphereGeometry args={[0.5, 18, 14]} /><meshStandardMaterial color="#2fbf7f" roughness={0.85} /></mesh>
      <mesh position={[0.22, 1.25, 0.1]} castShadow><sphereGeometry args={[0.3, 14, 10]} /><meshStandardMaterial color="#3ecf8e" roughness={0.85} /></mesh>
    </group>
  )
}

function Room({ headless }: { headless: boolean }) {
  return (
    <group>
      {/* Piso, tapete sob as mesas e rodapé com luz violeta→ciano. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[30, 18]} /><meshStandardMaterial color={NAVY} roughness={0.85} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -0.9]} receiveShadow><planeGeometry args={[11.5, 8.5]} /><meshStandardMaterial color="#1d1950" roughness={1} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, -0.9]}><ringGeometry args={[5.9, 6, 4, 1, Math.PI / 4]} /><meshBasicMaterial color={VIOLET} transparent opacity={0.25} /></mesh>
      <mesh position={[0, 2.5, -7]} receiveShadow><boxGeometry args={[30, 5, 0.2]} /><meshStandardMaterial color={WALL} roughness={0.9} /></mesh>
      <mesh position={[-13, 2.5, 0]} receiveShadow><boxGeometry args={[0.2, 5, 18]} /><meshStandardMaterial color={WALL} roughness={0.9} /></mesh>
      <mesh position={[0, 0.06, -6.88]}><boxGeometry args={[30, 0.05, 0.02]} /><meshBasicMaterial color={VIOLET} toneMapped={false} /></mesh>
      <mesh position={[-12.88, 0.06, 0]}><boxGeometry args={[0.02, 0.05, 18]} /><meshBasicMaterial color={CYAN} toneMapped={false} /></mesh>
      {/* Janelas iluminadas na parede do fundo. */}
      {[-5.5, 4.5].map(x => (
        <group key={x} position={[x, 2.7, -6.88]}>
          <mesh><planeGeometry args={[3.2, 2]} /><meshStandardMaterial color="#0c0b1f" emissive="#3b3290" emissiveIntensity={0.9} toneMapped={false} /></mesh>
          <mesh position={[0, 0, 0.01]}><planeGeometry args={[0.05, 2]} /><meshBasicMaterial color="#120f2e" /></mesh>
          <mesh position={[0, 0, 0.01]}><planeGeometry args={[3.2, 0.05]} /><meshBasicMaterial color="#120f2e" /></mesh>
          <mesh position={[0, -1.05, 0.08]}><boxGeometry args={[3.4, 0.08, 0.2]} /><meshStandardMaterial color="#2f2b63" /></mesh>
        </group>
      ))}
      {!headless && <Suspense fallback={null}><Logo /></Suspense>}
      {/* Luminárias pendentes sobre as fileiras. */}
      {[-4.5, 0, 4.5].map(x => (
        <group key={x} position={[x, 4.2, -0.6]}>
          <mesh position={[0, 0.4, 0]}><cylinderGeometry args={[0.01, 0.01, 0.8, 4]} /><meshBasicMaterial color="#2f2b63" /></mesh>
          <mesh><cylinderGeometry args={[0.18, 0.42, 0.25, 24, 1, true]} /><meshStandardMaterial color="#2a2462" side={2} /></mesh>
          <mesh position={[0, -0.1, 0]}><sphereGeometry args={[0.12, 12, 8]} /><meshBasicMaterial color="#fff1e6" toneMapped={false} /></mesh>
          <pointLight position={[0, -0.3, 0]} intensity={6} distance={6} color="#ffe8d6" />
        </group>
      ))}
      {/* Mesa de reunião redonda com cadeiras. */}
      <group position={[meetingCenter().x, 0, meetingCenter().z]} name="meeting-table">
        <mesh position={[0, 0.62, 0]} castShadow receiveShadow><cylinderGeometry args={[1.05, 1.05, 0.07, 48]} /><meshStandardMaterial color="#2a2462" roughness={0.5} /></mesh>
        <mesh position={[0, 0.31, 0]}><cylinderGeometry args={[0.12, 0.25, 0.62, 16]} /><meshStandardMaterial color="#120f2e" /></mesh>
        <mesh position={[0, 0.664, 0]}><ringGeometry args={[0.9, 0.95, 48]} /><meshBasicMaterial color={CYAN} transparent opacity={0.4} /></mesh>
      </group>
      {/* Canto do café: balcão, máquina, sofá e tapete redondo. */}
      <group position={[coffeeMachine().x, 0, coffeeMachine().z]} name="coffee">
        <mesh position={[0, 0.5, -0.6]} castShadow><boxGeometry args={[2.2, 1, 0.7]} /><meshStandardMaterial color="#221e52" /></mesh>
        <mesh position={[-0.4, 1.28, -0.65]} castShadow><boxGeometry args={[0.5, 0.55, 0.42]} /><meshStandardMaterial color="#0a091b" /></mesh>
        <mesh position={[-0.4, 1.38, -0.43]}><boxGeometry args={[0.22, 0.06, 0.02]} /><meshBasicMaterial color={CYAN} toneMapped={false} /></mesh>
        <mesh position={[0.5, 1.08, -0.6]}><cylinderGeometry args={[0.07, 0.06, 0.14, 12]} /><meshStandardMaterial color={VIOLET} /></mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 1.4]}><circleGeometry args={[1.5, 40]} /><meshStandardMaterial color="#241f5c" /></mesh>
        <group position={[0, 0, 2.6]}>
          <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[2.4, 0.4, 0.8]} /><meshStandardMaterial color={VIOLET} roughness={0.8} /></mesh>
          <mesh position={[0, 0.7, 0.32]} castShadow><boxGeometry args={[2.4, 0.6, 0.18]} /><meshStandardMaterial color="#6f56d8" roughness={0.8} /></mesh>
        </group>
      </group>
      {/* Estante com livros na parede da esquerda. */}
      <group position={[-12.7, 0, -3.6]} rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, 1.2, 0]} castShadow><boxGeometry args={[2.4, 2.4, 0.45]} /><meshStandardMaterial color="#221e52" /></mesh>
        {[0.6, 1.3, 2.0].map((y, r) => [-0.8, -0.45, -0.1, 0.3, 0.7].map((x, i) => (
          <mesh key={`${r}-${i}`} position={[x, y, 0.1]}><boxGeometry args={[0.22, 0.5, 0.3]} />
            <meshStandardMaterial color={[VIOLET, CYAN, '#f5a524', '#3ecf8e', '#f472b6'][(i + r) % 5]} roughness={0.7} />
          </mesh>
        )))}
      </group>
      <Plant x={-12} z={-6.2} s={1.2} /><Plant x={11.8} z={-6.2} s={1.2} /><Plant x={-12} z={4.5} /><Plant x={6} z={-6.2} s={0.8} />
    </group>
  )
}

function Logo() {
  const tex = useTexture(icon)
  return (
    <group position={[-0.6, 3.1, -6.88]}>
      <mesh position={[0, 0, -0.01]}><planeGeometry args={[1.9, 1.9]} /><meshBasicMaterial color="#120f2e" /></mesh>
      <mesh><planeGeometry args={[1.6, 1.6]} /><meshBasicMaterial map={tex} transparent toneMapped={false} /></mesh>
      <pointLight position={[0, 0, 1]} intensity={5} distance={5} color={VIOLET} />
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
      // Parado, sempre de frente para nós.
      body.current.rotation.y += (0 - body.current.rotation.y) * Math.min(1, dt * 6)
    }
    if (g.current) g.current.position.set(pos.current.x, 0, pos.current.z)
  })

  if (locked) return <group name={`office-mascot-${agent.id}`} position={[home.desk.x, 0, home.desk.z]} visible={false} />
  return (
    <group ref={g} name={`office-mascot-${agent.id}`} position={[home.desk.x, 0, home.desk.z]}>
      <group ref={body} scale={SCALE} position={[0, 0.62 * SCALE + (place === 'desk' ? 0.3 : 0), 0]}
        onClick={e => { e.stopPropagation(); onSelect(agent.id) }}
        onPointerOver={() => { document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
        <MascotBody agentId={agent.id} look={look} frame={frame} t={t} />
      </group>
      {labels && (
        <>
          <Html position={[0, 2.35, 0]} zIndexRange={[20, 10]} portal={portal as RefObject<HTMLElement>} style={{ pointerEvents: 'none' }}><Bubble view={view} /></Html>
          <Html center position={[0, 1.75, 0]} zIndexRange={[10, 0]} portal={portal as RefObject<HTMLElement>}>
            <div className="office-tag" data-agent={agent.id} data-pose={view.pose} onClick={() => onSelect(agent.id)} title={view.label}>
              <i className={`odot ${view.pose}`} /><b>{agent.nome}</b>{view.pose !== 'idle' && <span>{view.label}</span>}
            </div>
          </Html>
        </>
      )}
    </group>
  )
}

function OfficeCamera() {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    // Mais baixa e de frente: a sala aparece como um palco. Janela mais estreita afasta a câmera.
    const far = Math.max(1, 1.8 / (size.width / size.height))
    camera.position.set(0, 5.9 * far, 14.6 * far)
    camera.lookAt(0, 0.9, -1.4)
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
      {!headless && <fog attach="fog" args={['#0c0b1f', 22, 42]} />}
      <hemisphereLight args={['#e9e6ff', '#151238', 1.0]} />
      <directionalLight position={[5, 10, 9]} intensity={1.9} color="#fff1e6" castShadow shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-15} shadow-camera-right={15} shadow-camera-top={10} shadow-camera-bottom={-10} />
      <directionalLight position={[-8, 4, -4]} intensity={0.9} color={VIOLET} />
      <Room headless={headless} />
      {!headless && (
        <Html position={[-8.6, 3.6, -6.85]} center zIndexRange={[4, 0]} portal={portal as RefObject<HTMLElement>}>
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
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[desk.x, 0.012, desk.z]}><ringGeometry args={[0.55, 0.64, 40]} /><meshBasicMaterial color={VIOLET} transparent opacity={0.5} /></mesh>
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
        <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 36, position: [0, 5.9, 14.6] }} gl={{ alpha: true, antialias: true, toneMapping: ACESFilmicToneMapping, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); console.warn('escritório: contexto WebGL perdido'); setLost(n => n + 1) })}>
          <OfficeScene views={views} selected={selectedAgent} onSelect={selectAgent} portal={overlay} agents={agents} team={team} coffeeAgent={coffee} />
        </Canvas>
      </CanvasBoundary>
      <div className="stage-overlay" ref={overlay} />
    </div>
  )
}
