import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useRef, type RefObject } from 'react'
import type { Group } from 'three'
import { getAgent, type AgentId } from '@shared/agents'
import { providerName } from '@shared/profiles'
import type { MascotView } from './derive'
import { DimContext } from './materials'
import { MascotBody } from './mascots'
import { GROUND } from './mascots/types'
import { motionFrame, type MotionFrame } from './motion'
import { reducedMotion } from './reducedMotion'
import { useLookStore } from '../state/lookStore'

const TOOL = { claude: 'Claude Code', codex: 'Codex', gemini: 'Antigravity', opencode: 'opencode' }

export function MascotLabel({ id, view, onSelect }: { id: AgentId; view: MascotView; onSelect: () => void }) {
  const a = getAgent(id)
  return (
    <div className={`tag ${view.pose === 'locked' ? 'locked' : ''}`} data-agent={id} data-pose={view.pose} onClick={onSelect}>
      <div className="nm">{a.nome}</div>
      <div className="tool">{a.transport.kind === 'api' ? `${providerName(a.transport.provider)} · API` : TOOL[a.tool]}</div>
      <div className={`pill ${view.pose}`}><i />{view.label}</div>
    </div>
  )
}

export function Bubble({ view }: { view: MascotView }) {
  if (view.bubbleKind === 'dots') return <div className="bubble dots"><span /><span /><span /></div>
  if (!view.bubble) return null
  return <div className={`bubble ${view.bubbleKind ?? 'text'}`}>{view.bubble}</div>
}

export const Mascot = memo(function Mascot({ id, index, x, view, selected, onSelect, labels, portal }: {
  id: AgentId; index: number; x: number; view: MascotView; selected: boolean; onSelect(id: AgentId): void; labels: boolean
  portal?: RefObject<HTMLElement | null>
}) {
  const root = useRef<Group>(null)
  const t = useRef(0)
  const frame = useRef<MotionFrame>(motionFrame(view.pose, 0, 0, 0))
  const since = useRef<{ pose?: string; at: number }>({ at: 0 })
  const locked = view.pose === 'locked'
  const phase = index * 1.3
  const select = () => { if (!locked) onSelect(id) }
  const look = useLookStore(s => s.looks[id])
  const eyes = look?.eyes ?? (id === 'forja' ? 'squint' : undefined)

  useFrame(({ clock }) => {
    t.current = clock.elapsedTime
    if (since.current.pose !== view.pose) since.current = { pose: view.pose, at: t.current }
    frame.current = motionFrame(view.pose, t.current, phase, t.current - since.current.at, {
      float: (look?.body ?? (getAgent(id).family === 'gemini' ? 'star' : '')) === 'star', defaultExpression: eyes, reduced: reducedMotion(),
    })
    if (root.current) root.current.rotation.y = frame.current.rotY
  })

  return (
    <group name={`mascot-${id}`} position={[x, 0, 0]}>
      <group
        ref={root}
        onClick={e => { e.stopPropagation(); select() }}
        onPointerOver={() => { if (!locked) document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = '' }}
      >
        <DimContext.Provider value={locked}>
          <MascotBody agentId={id} look={look} frame={frame} t={t} />
        </DimContext.Provider>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND + 0.005, 0]} visible={selected}>
        <ringGeometry args={[0.95, 1.05, 48]} />
        <meshBasicMaterial color="#8b6cf6" transparent opacity={0.35} />
      </mesh>
      {labels && (
        <>
          <Html center position={[0, -1.25, 0.4]} zIndexRange={[10, 0]} portal={portal as RefObject<HTMLElement>}><MascotLabel id={id} view={view} onSelect={select} /></Html>
          <Html position={[0, 1.8, 0]} zIndexRange={[20, 10]} portal={portal as RefObject<HTMLElement>} style={{ pointerEvents: 'none' }}><Bubble view={view} /></Html>
        </>
      )}
    </group>
  )
})
