// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paceFor } from '../../src/renderer/stage/pace'
import { createEventBatcher } from '../../src/renderer/state/eventBatcher'
import { stableViews } from '../../src/renderer/stage/useStageViews'
import { useRunStore } from '../../src/renderer/state/runStore'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('ritmo de desenho do 3D', () => {
  const base = { hidden: false, covered: false, focused: true, active: false }
  it('não desenha nada com a janela escondida ou coberta por uma tela', () => {
    expect(paceFor({ ...base, hidden: true, active: true })).toBe(0)
    expect(paceFor({ ...base, covered: true, active: true })).toBe(0)
  })
  it('agente trabalhando anima mais do que time parado, e nunca a 60 por segundo', () => {
    const working = paceFor({ ...base, active: true }), idle = paceFor(base)
    expect(working).toBeGreaterThan(idle)
    expect(working).toBeLessThanOrEqual(30)
    expect(idle).toBeLessThanOrEqual(15)
  })
  it('janela sem foco desenha bem menos', () => {
    expect(paceFor({ ...base, focused: false })).toBeLessThan(paceFor(base))
    expect(paceFor({ ...base, focused: false, active: true })).toBeLessThan(paceFor({ ...base, active: true }))
  })
})

describe('lote de eventos', () => {
  it('junta os eventos da janela de tempo numa entrega só, na ordem', () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const b = createEventBatcher(flush, 80)
    b.push('r', { type: 'text', text: 'a' } as never)
    b.push('r', { type: 'text', text: 'b' } as never)
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(80)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush.mock.calls[0][0].map((i: { ev: { text: string } }) => i.ev.text)).toEqual(['a', 'b'])
  })
  it('ao parar, entrega o que ficou', () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const b = createEventBatcher(flush, 80)
    b.push('r', { type: 'text', text: 'a' } as never)
    b.stop()
    expect(flush).toHaveBeenCalledTimes(1)
  })
})

describe('store', () => {
  it('receiveMany aplica vários eventos com uma só atualização', () => {
    const seen = vi.fn()
    const off = useRunStore.subscribe(seen)
    useRunStore.getState().receiveMany([
      { runId: 'x', ev: { type: 'run_started', agentId: 'forja' } as never },
      { runId: 'x', ev: { type: 'text', text: 'oi' } as never },
    ])
    off()
    expect(seen).toHaveBeenCalledTimes(1)
    expect(useRunStore.getState().chat.runs.find(r => r.runId === 'x')?.text).toBe('oi')
  })
})

describe('estado dos mascotes', () => {
  it('mantém o mesmo objeto de quem não mudou', () => {
    const a = { pose: 'idle', label: 'livre' }, b = { pose: 'idle', label: 'livre' }
    const prev = { x: a, y: a } as never
    const next = stableViews(prev, { x: { ...b }, y: { pose: 'working', label: 'ok' } } as never) as Record<string, unknown>
    expect(next.x).toBe(a)
    expect(next.y).not.toBe(a)
  })
  it('sem mudança nenhuma, devolve o objeto anterior inteiro', () => {
    const prev = { x: { pose: 'idle' } } as never
    expect(stableViews(prev, { x: { pose: 'idle' } } as never)).toBe(prev)
  })
})

describe('checagem de WebGL', () => {
  it('cria um só contexto, por mais que seja chamada', async () => {
    vi.resetModules()
    const create = vi.spyOn(document, 'createElement')
    const { hasWebGL } = await import('../../src/renderer/stage/webgl')
    hasWebGL(); hasWebGL(); hasWebGL()
    expect(create.mock.calls.filter(c => c[0] === 'canvas').length).toBe(1)
  })
})
