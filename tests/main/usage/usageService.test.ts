import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UsageSnapshot } from '@shared/usage'
import { openStore } from '../../../src/main/store/db'
import { UsageService } from '../../../src/main/usage/usageService'
import { pollClaudeUsage } from '../../../src/main/adapters/claude'

const H = 3_600_000
function setup(now = { t: Date.UTC(2026, 10, 1, 15) }) {
  const store = openStore(':memory:')
  const c = store.createConversation(store.upsertProject('/p').id, 't')
  store.createRun({ id: 'r', conversationId: c.id, agentId: 'forja', prompt: 'x', startedAt: 1, hasCheckpoint: true })
  const snaps: UsageSnapshot[] = []
  const svc = new UsageService({ store, now: () => now.t, emit: s => snaps.push(s) })
  const row = (tool: string) => svc.snapshot().rows.find(r => r.tool === tool)!
  return { store, svc, snaps, now, row }
}

describe('UsageService', () => {
  afterEach(() => vi.useRealTimers())

  it('Claude: barra = janela de 5 h; alerta pela janela mais usada; tokens só dentro da janela', () => {
    const { store, row, now } = setup()
    const resets = now.t + 2 * H
    store.recordLimit({ tool: 'claude', window: 'five_hour', utilization: 62, resetsAt: resets, at: now.t })
    store.recordLimit({ tool: 'claude', window: 'seven_day', utilization: 91, at: now.t })
    store.recordUsage('r', 'forja', 'claude', { input: 100, output: 10, cacheRead: 0, reasoning: 0 }, now.t - 4 * H) // antes da janela
    store.recordUsage('r', 'forja', 'claude', { input: 50, output: 5, cacheRead: 0, reasoning: 0 }, now.t - H)
    expect(row('claude')).toMatchObject({ utilization: 62, estimated: false, window: 'five_hour', alert: true, tokens: { input: 50, output: 5 } })
  })

  it('ferramenta sem nenhum dado: sem porcentagem, sem alerta', () => {
    const { row } = setup()
    expect(row('gemini')).toMatchObject({ utilization: null, estimated: false, alert: false, tokens: { input: 0, output: 0 } })
    expect(row('opencode').utilization).toBeNull()
  })

  it('estimativa com teto diário; meia-noite zera', () => {
    const { store, svc, row, now } = setup()
    svc.updateSettings({ perTool: { codex: { estimateCeilingTokens: 1_000_000 } } })
    store.recordUsage('r', 'forja', 'codex', { input: 200_000, output: 50_000, cacheRead: 0, reasoning: 0 }, now.t - H)
    expect(row('codex')).toMatchObject({ utilization: 25, estimated: true, window: 'estimated' })
    now.t += 24 * H
    expect(row('codex')).toMatchObject({ utilization: 0, tokens: { input: 0, output: 0 } })
  })

  it('limite oficial do Codex vence a estimativa', () => {
    const { store, svc, row, now } = setup()
    svc.updateSettings({ perTool: { codex: { estimateCeilingTokens: 1_000 } } })
    store.recordLimit({ tool: 'codex', window: 'five_hour', utilization: 14, resetsAt: now.t + H, at: now.t })
    expect(row('codex')).toMatchObject({ utilization: 14, estimated: false })
  })

  it('janela que já resetou deixa de valer', () => {
    const { store, row, now } = setup()
    store.recordLimit({ tool: 'claude', window: 'five_hour', utilization: 95, resetsAt: now.t - 1, at: now.t - H })
    expect(row('claude')).toMatchObject({ utilization: null, alert: false })
  })

  it('limite de alerta por ferramenta e persistência das configurações', () => {
    const { store, svc, row, now } = setup()
    store.recordLimit({ tool: 'claude', window: 'five_hour', utilization: 62, resetsAt: now.t + H, at: now.t })
    expect(row('claude').alert).toBe(false)
    svc.updateSettings({ perTool: { claude: { alertAt: 60 } } })
    expect(row('claude').alert).toBe(true)
    expect(new UsageService({ store, emit: () => {} }).settings().perTool.claude?.alertAt).toBe(60)
  })

  it('null apaga o ajuste da ferramenta e volta ao geral', () => {
    const { svc } = setup()
    svc.updateSettings({ perTool: { claude: { alertAt: 1, estimateCeilingTokens: 500 } } })
    svc.updateSettings({ perTool: { claude: { alertAt: null } } })
    expect(svc.alertAt('claude')).toBe(90)
    expect(svc.settings().perTool.claude).toEqual({ estimateCeilingTokens: 500 })
  })

  it('linha API só aparece quando há uso de API, sem porcentagem nem alerta', () => {
    const { store, svc, now } = setup()
    expect(svc.snapshot().rows.map(r => r.tool)).toEqual(['claude', 'codex', 'gemini', 'opencode'])
    store.recordUsage('r', 'kimi', 'api', { input: 100, output: 20, cacheRead: 0, reasoning: 0 }, now.t)
    const api = svc.snapshot().rows.find(r => r.tool === 'api')
    expect(api).toMatchObject({ utilization: null, alert: false, tokens: { input: 100, output: 20 } })
  })

  it('emite no máximo um snapshot por segundo', async () => {
    vi.useFakeTimers()
    const { svc, snaps } = setup()
    const ev = { type: 'usage', tool: 'claude', tokens: { input: 1, output: 1, cacheRead: 0, reasoning: 0 } } as const
    svc.onEvent('r', 'forja', ev); svc.onEvent('r', 'forja', ev); svc.onEvent('r', 'forja', ev)
    expect(snaps).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1100)
    expect(snaps).toHaveLength(2)
  })

  it('I-5: não começa outra consulta enquanto a anterior não volta', async () => {
    const { store, now } = setup()
    let calls = 0
    let done!: () => void
    const svc = new UsageService({ store, now: () => now.t, emit: () => {}, pollClaude: () => { calls++; return new Promise(r => { done = () => r([]) }) } })
    const a = svc.pollOnce(); const b = svc.pollOnce()
    expect(calls).toBe(1)
    done(); await Promise.all([a, b])
  })

  it('polling grava os limites que a consulta devolver', async () => {
    const { store, now } = setup()
    const svc = new UsageService({ store, now: () => now.t, emit: () => {}, pollClaude: async () => [{ tool: 'claude', window: 'five_hour', utilization: 29, at: now.t }] })
    await svc.pollOnce()
    expect(store.latestLimits()).toEqual([{ tool: 'claude', window: 'five_hour', utilization: 29, at: now.t }])
  })
})

describe('pollClaudeUsage', () => {
  it('lê 5 h e semanal da consulta de uso sem mandar mensagem', async () => {
    let sentMessages = 0
    const fakeQuery = ((p: { prompt: AsyncIterable<unknown> }) => {
      void (async () => { for await (const _ of p.prompt) sentMessages++ })()
      return {
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
          rate_limits_available: true,
          rate_limits: { five_hour: { utilization: 29, resets_at: '2026-11-01T13:49:59Z' }, seven_day: { utilization: 87, resets_at: '2026-11-02T01:59:59Z' }, seven_day_opus: null },
        }),
        interrupt: async () => {}, close: () => {},
      }
    }) as never
    const out = await pollClaudeUsage(fakeQuery, () => 5)
    expect(out).toEqual([
      { tool: 'claude', window: 'five_hour', utilization: 29, resetsAt: Date.parse('2026-11-01T13:49:59Z'), at: 5 },
      { tool: 'claude', window: 'seven_day', utilization: 87, resetsAt: Date.parse('2026-11-02T01:59:59Z'), at: 5 },
    ])
    expect(sentMessages).toBe(0)
  })
  it('I-5: consulta que não responde desiste no prazo e encerra o processo', async () => {
    let interrupted = false
    const hang = (() => ({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => new Promise(() => {}), interrupt: async () => { interrupted = true }, close: () => {} })) as never
    expect(await pollClaudeUsage(hang, Date.now, 50)).toEqual([])
    expect(interrupted).toBe(true)
  })
  it('sem dados de plano devolve vazio; erro devolve vazio', async () => {
    const none = (() => ({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({ rate_limits_available: false, rate_limits: null }), interrupt: async () => {}, close: () => {} })) as never
    expect(await pollClaudeUsage(none)).toEqual([])
    const boom = (() => ({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => { throw new Error('x') }, interrupt: async () => {}, close: () => {} })) as never
    expect(await pollClaudeUsage(boom)).toEqual([])
  })
})
