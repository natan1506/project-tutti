import { Canvas } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { BODIES, EYES, SWATCHES, defaultBody, type Look } from '@shared/look'
import { resolveAgentDefs } from '@shared/profiles'
import { agentColor } from '../stage/colors'
import { MascotBody } from '../stage/mascots'
import { motionFrame, type MotionFrame } from '../stage/motion'
import { hasWebGL } from '../stage/Stage'
import { useLookStore } from '../state/lookStore'
import { useProfileStore } from '../state/profileStore'

// Tela Mascotes: corpo, cor e olhos de cada agente, com prévia 3D. Vale no palco e no escritório.

function Preview({ agentId, look }: { agentId: string; look?: Look }) {
  const frame = useRef<MotionFrame>(motionFrame('idle', 0, 0, 0, { defaultExpression: look?.eyes }))
  const t = useRef(0)
  frame.current = motionFrame('idle', 0, 0, 0, { defaultExpression: look?.eyes })
  return (
    <Canvas camera={{ fov: 30, position: [0, 0.8, 5.2] }} gl={{ alpha: true, antialias: true }} shadows>
      <hemisphereLight args={['#e9e6ff', '#151238', 1.3]} />
      <directionalLight position={[3, 6, 6]} intensity={2.4} castShadow />
      <directionalLight position={[-5, 2, -4]} intensity={1} color="#7b6cf6" />
      <group rotation={[0, -0.35, 0]}><MascotBody agentId={agentId} look={look} frame={frame} t={t} /></group>
    </Canvas>
  )
}

export function MascotsScreen({ preview = hasWebGL() }: { preview?: boolean }) {
  const profiles = useProfileStore(s => s.profiles)
  const { looks, set, setOpen } = useLookStore()
  const agents = profiles.flatMap(p => resolveAgentDefs(p).map(a => ({ ...a, profile: p.nome })))
  const [sel, setSel] = useState(agents[0]?.id)
  const a = agents.find(x => x.id === sel) ?? agents[0]
  if (!a) return null
  const look = looks[a.id] ?? {}
  const body = look.body ?? defaultBody(a)
  const colorable = body === 'clawd-arms' || body === 'clawd-ears'
  const color = look.color ?? agentColor(a)
  const change = (p: Partial<Look>) => void set(a.id, { ...look, ...p })

  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <div className="modal profiles mascots" onClick={e => e.stopPropagation()}>
        <div className="row between"><b>Mascotes</b><button onClick={() => setOpen(false)}>Fechar</button></div>
        <div className="profiles-body">
          <aside className="profiles-list">
            {agents.map(x => (
              <button key={x.id} className={x.id === a.id ? 'on' : ''} onClick={() => setSel(x.id)}>
                <span className="mascot-item"><i className="agent-dot" style={{ background: looks[x.id]?.color ?? agentColor(x) }} />{x.nome}</span>
                <small>{x.profile}</small>
              </button>
            ))}
          </aside>
          <section className="mascot-edit">
            <div className="mascot-preview">{preview ? <Preview agentId={a.id} look={looks[a.id]} /> : <div className="mascot-preview-off" style={{ background: color }} />}</div>
            <div className="mascot-controls">
              <h4>{a.nome}</h4>
              <label className="block">Corpo
                <select aria-label="Corpo" value={body} onChange={e => change({ body: e.target.value as Look['body'] })}>
                  {BODIES.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
                </select>
              </label>
              <div className="block">Cor
                <div className="swatches">
                  {SWATCHES.map(c => (
                    <button key={c} aria-label={`Cor ${c}`} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} disabled={!colorable} onClick={() => change({ color: c })} />
                  ))}
                  <input type="color" aria-label="Cor personalizada" value={color} disabled={!colorable} onChange={e => change({ color: e.target.value })} />
                </div>
                {!colorable && <small className="field-help">Este corpo usa as cores da ferramenta.</small>}
              </div>
              <div className="block">Olhos
                <div className="autonomy eyes-pick" role="group" aria-label="Olhos">
                  {EYES.map(e => <button key={e.id} className={(look.eyes ?? 'normal') === e.id ? 'on' : ''} onClick={() => change({ eyes: e.id })}>{e.nome}</button>)}
                </div>
              </div>
              <button className="link" onClick={() => void set(a.id, null)}>Restaurar padrão</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
