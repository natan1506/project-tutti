import { Environment, Lightformer } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ACESFilmicToneMapping } from 'three'
import { AGENTS, type AgentId } from '@shared/agents'
import { useRunStore } from '../state/runStore'
import { deriveStage, type MascotView } from './derive'
import { bubbleMaxWidth, fitCameraDistance, mascotX, SPACING } from './layout'
import { Bubble, Mascot, MascotLabel } from './Mascot'
import { GROUND } from './mascots/types'
import './stage.css'

const FOV = 28

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

/** Qualquer erro dentro da cena 3D (renderer, shaders, mascotes) vira fallback 2D em vez de derrubar o app. */
export class CanvasBoundary extends Component<{ onError(e: unknown): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { this.props.onError(e) }
  render() { return this.state.failed ? null : this.props.children }
}

/** Afasta a câmera o suficiente para os seis mascotes caberem na largura do palco. */
function CameraRig() {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    camera.position.set(0, 1.5, fitCameraDistance(AGENTS.length, SPACING, FOV, size.width / size.height))
    camera.lookAt(0, 0.3, 0)
    camera.updateProjectionMatrix()
  }, [camera, size])
  return null
}

/** `headless` desliga rótulos HTML e o reflexo de ambiente, que exigem DOM e WebGL reais (usado nos testes). */
export function StageScene({ views, selected, onSelect, headless = false, portal }: {
  views: Record<AgentId, MascotView>; selected: AgentId; onSelect(id: AgentId): void; headless?: boolean
  portal?: RefObject<HTMLElement | null>
}) {
  return (
    <>
      <CameraRig />
      <hemisphereLight args={['#e9e6ff', '#151238', 1.2]} />
      <directionalLight
        position={[3, 7, 8]} intensity={2.6} color="#fff1e6" castShadow
        shadow-mapSize={[2048, 2048]} shadow-radius={8}
        shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={6} shadow-camera-bottom={-4}
      />
      <directionalLight position={[-6, 3, -5]} intensity={1.1} color="#7b6cf6" />
      {/* Reflexo suave feito só de Lightformers: nada é baixado da internet. */}
      {!headless && (
        <Environment resolution={64}>
          <Lightformer form="rect" intensity={2} color="#ffffff" position={[0, 5, 5]} scale={[10, 4, 1]} />
          <Lightformer form="rect" intensity={1.2} color="#8b6cf6" position={[-6, 2, -4]} scale={[6, 6, 1]} />
        </Environment>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND, 0]} receiveShadow>
        <planeGeometry args={[40, 20]} />
        <shadowMaterial opacity={0.38} />
      </mesh>
      {AGENTS.map((a, i) => (
        <Mascot key={a.id} id={a.id} index={i} x={mascotX(i, AGENTS.length)} view={views[a.id]}
          selected={a.id === selected} onSelect={onSelect} labels={!headless} portal={portal} />
      ))}
    </>
  )
}

/** Fileira 2D da Fase 1, usada quando não há WebGL. */
function FlatStage({ views, onSelect }: { views: Record<AgentId, MascotView>; onSelect(id: AgentId): void }) {
  return (
    <div className="cast">
      {AGENTS.map(a => {
        const v = views[a.id]
        const select = () => { if (v.pose !== 'locked') onSelect(a.id) }
        return (
          <div key={a.id} className={`agent ${v.pose === 'locked' ? 'later' : ''}`}>
            <div className={`avatar dot-${a.id}`} onClick={select} />
            <Bubble view={v} />
            <MascotLabel id={a.id} view={v} onSelect={select} />
          </div>
        )
      })}
    </div>
  )
}

export function Stage({ webgl }: { webgl?: boolean } = {}) {
  const { chat, selectedAgent, selectAgent, tools } = useRunStore()
  const [canUse] = useState(() => webgl ?? hasWebGL())
  const [lost, setLost] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // Rederiva a cada meio segundo para os balões de "concluído" sumirem no tempo certo.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  const views = useMemo(() => deriveStage(chat, now, tools), [chat, now, tools])
  // Rótulos e balões vão para uma camada própria: o <Html> do drei não acha o pai do canvas no primeiro quadro.
  const overlay = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  // Balões nunca mais largos que o espaço entre mascotes, para não se sobreporem em janelas estreitas.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => el.style.setProperty('--bubble-max', `${bubbleMaxWidth(e.contentRect.width, AGENTS.length)}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [canUse, lost])

  if (!canUse || lost) return <FlatStage views={views} onSelect={selectAgent} />
  return (
    <div className="stage-3d" ref={box}>
      <CanvasBoundary onError={() => setLost(true)}>
        <Canvas
          shadows dpr={[1, 2]} camera={{ fov: FOV, position: [0, 1.5, 12] }}
          gl={{ alpha: true, antialias: true, toneMapping: ACESFilmicToneMapping }}
          onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); setLost(true) })}
        >
          <StageScene views={views} selected={selectedAgent} onSelect={selectAgent} portal={overlay} />
        </Canvas>
      </CanvasBoundary>
      <div className="stage-overlay" ref={overlay} />
    </div>
  )
}
