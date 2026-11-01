import { describe, expect, it } from 'vitest'
import type { RunEvent } from '@shared/events'
import type { UsageSnapshot } from '@shared/usage'
import { applyEvent, emptyChat } from '../../src/renderer/state/chat'
import { formatTokens } from '../../src/renderer/state/format'
import { useUsageStore } from '../../src/renderer/state/usageStore'
import { deriveStage } from '../../src/renderer/stage/derive'

describe('formatTokens', () => {
  it.each([[0, '0'], [950, '950'], [12_345, '12,3 mil'], [1_234_567, '1,2 mi']])('%i → %s', (n, s) => {
    expect(formatTokens(n)).toBe(s)
  })
  it('milhar redondo', () => expect(formatTokens(4_000)).toBe('4 mil'))
})

describe('aviso de limite no chat e no palco', () => {
  const start: [string, RunEvent] = ['r', { type: 'run_started', runId: 'r', agentId: 'forja' }]
  const warn: [string, RunEvent] = ['r', { type: 'limit_warning', id: 'w', tool: 'claude', window: 'five_hour', utilization: 92, to: 'curinga' }]
  const play = (evs: [string, RunEvent][]) => evs.reduce((s, [id, ev]) => applyEvent(s, id, ev), emptyChat())

  it('aviso pendente: cartão no bloco, agente esperando, palco "Limite quase no fim"', () => {
    const s = play([start, warn])
    expect(s.runs[0].limitWarnings).toEqual([{ id: 'w', tool: 'claude', window: 'five_hour', utilization: 92, to: 'curinga' }])
    expect(s.agentStatus.forja).toBe('esperando')
    expect(deriveStage(s, 0).forja).toEqual({ pose: 'waiting', label: 'Esperando você', bubble: 'Limite quase no fim', bubbleKind: 'alert' })
  })

  it('resposta fecha o cartão; troca guarda a nota', () => {
    const s = play([start, warn, ['r', { type: 'limit_resolved', id: 'w', pass: true }], ['r', { type: 'handoff', to: 'curinga', newRunId: 'n' }]])
    expect(s.runs[0].limitWarnings[0]).toMatchObject({ id: 'w', pass: true })
    expect(s.runs[0].handoff).toEqual({ to: 'curinga', newRunId: 'n' })
    expect(s.agentStatus.forja).toBe('trabalhando')
  })

  it('eventos de uso ao vivo não mexem no chat', () => {
    const s0 = play([start])
    expect(applyEvent(s0, 'r', { type: 'usage', tool: 'claude', tokens: { input: 1, output: 1, cacheRead: 0, reasoning: 0 } })).toBe(s0)
  })
})

describe('usageStore', () => {
  it('guarda o último snapshot', () => {
    const snap = (at: number): UsageSnapshot => ({ at, rows: [] })
    useUsageStore.getState().setSnapshot(snap(1))
    useUsageStore.getState().setSnapshot(snap(2))
    expect(useUsageStore.getState().snapshot?.at).toBe(2)
  })
})
