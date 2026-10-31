// @vitest-environment jsdom
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AGENTS, type AgentId } from '@shared/agents'
import { emptyChat } from '../../../src/renderer/state/chat'
import { useRunStore } from '../../../src/renderer/state/runStore'
import { deriveStage } from '../../../src/renderer/stage/derive'
import { mascotX } from '../../../src/renderer/stage/layout'
import { Stage, StageScene } from '../../../src/renderer/stage/Stage'
import { MascotBody } from '../../../src/renderer/stage/mascots'
import { motionFrame, type MotionFrame } from '../../../src/renderer/stage/motion'

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>

async function body(agentId: AgentId, frame: MotionFrame = motionFrame('idle', 0, 0, 0)) {
  const ref = { current: frame }
  const r = await ReactThreeTestRenderer.create(<MascotBody agentId={agentId} frame={ref} t={{ current: 0 }} />)
  return { r, ref }
}
const named = (r: Renderer, name: string) => r.scene.findAll(n => n.props.name === name)

describe('MascotBody', () => {
  it('Bússola é o bichinho do Claude com bracinhos', async () => {
    const { r } = await body('bussola')
    expect(named(r, 'body-clawd')).toHaveLength(1)
    expect(named(r, 'arm')).toHaveLength(2)
    expect(named(r, 'ear')).toHaveLength(0)
    expect(named(r, 'leg')).toHaveLength(4)
  })

  it.each(['forja', 'pincel'] as const)('%s é o bichinho do Claude com orelhas', async id => {
    const { r } = await body(id)
    expect(named(r, 'body-clawd')).toHaveLength(1)
    expect(named(r, 'ear')).toHaveLength(2)
    expect(named(r, 'arm')).toHaveLength(0)
    expect(named(r, 'leg')).toHaveLength(4)
  })

  it('Radar é a estrela flutuante, sem pernas', async () => {
    const { r } = await body('radar')
    expect(named(r, 'body-star')).toHaveLength(1)
    expect(named(r, 'leg')).toHaveLength(0)
  })

  it('Lupa é a nuvem com tela no rosto', async () => {
    const { r } = await body('lupa')
    expect(named(r, 'body-cloud')).toHaveLength(1)
    expect(named(r, 'screen-face').length).toBeGreaterThanOrEqual(1)
  })

  it('Curinga é o bloco com tela e antena', async () => {
    const { r } = await body('curinga')
    expect(named(r, 'body-block')).toHaveLength(1)
    expect(named(r, 'screen-face').length).toBeGreaterThanOrEqual(1)
    expect(named(r, 'antenna')).toHaveLength(1)
  })

  it('olhos mostram só a expressão do quadro atual', async () => {
    const { r, ref } = await body('pincel')
    ref.current = motionFrame('working', 0.3, 0, 0)
    await r.advanceFrames(1, 16)
    const visible = (name: string) => named(r, name).map(n => n.instance.visible)
    expect(visible('eye-squint')).toEqual([true, true])
    expect(visible('eye-normal')).toEqual([false, false])
    expect(visible('eye-happy')).toEqual([false, false])
  })
})

describe('Stage sem WebGL', () => {
  it('cai para a fileira 2D com os seis agentes', () => {
    const { container } = render(<Stage webgl={false} />)
    expect(container.querySelectorAll('.agent')).toHaveLength(6)
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('clicar em agente da Fase 3 não troca a aba; clicar no Lupa troca', () => {
    useRunStore.setState({ selectedAgent: 'forja' })
    const { container } = render(<Stage webgl={false} />)
    fireEvent.click(container.querySelector('[data-agent="radar"]')!)
    expect(useRunStore.getState().selectedAgent).toBe('forja')
    fireEvent.click(container.querySelector('[data-agent="lupa"]')!)
    expect(useRunStore.getState().selectedAgent).toBe('lupa')
  })
})

describe('StageScene', () => {
  it('posiciona os seis mascotes em fileira', async () => {
    const r = await ReactThreeTestRenderer.create(
      <StageScene views={deriveStage(emptyChat(), 0)} selected="forja" onSelect={() => {}} headless />,
    )
    AGENTS.forEach((a, i) => {
      const [g] = r.scene.findAll(n => n.props.name === `mascot-${a.id}`)
      expect(g.instance.position.x).toBeCloseTo(mascotX(i, AGENTS.length))
    })
  })
})
