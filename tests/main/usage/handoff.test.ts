import { describe, expect, it } from 'vitest'
import type { AgentId, ToolKind } from '@shared/agents'
import type { ToolUsageRow, UsageSnapshot } from '@shared/usage'
import { registerAgents } from '@shared/agents'
import { resolveAgentDefs } from '@shared/profiles'
import { pickReplacement } from '../../../src/main/usage/handoff'

const ALL: AgentId[] = ['bussola', 'forja', 'pincel', 'radar', 'lupa', 'curinga']
const snap = (u: Partial<Record<ToolKind, number | null>>): UsageSnapshot => ({
  at: 0,
  rows: (['claude', 'codex', 'gemini', 'opencode'] as ToolKind[]).map(tool => ({
    tool, utilization: u[tool] ?? null, estimated: false, window: null, tokens: { input: 0, output: 0, cacheRead: 0, reasoning: 0 }, alert: false,
  } as ToolUsageRow)),
})
const at90 = () => 90

describe('pickReplacement', () => {
  it('Forja (Claude, escreve) no limite → Curinga (opencode, escreve)', () => {
    expect(pickReplacement('forja', ALL, snap({ claude: 92 }), at90)).toBe('curinga')
  })
  it('Radar (só lê) → Lupa (só lê, outra ferramenta)', () => {
    expect(pickReplacement('radar', ALL, snap({ gemini: 95, codex: 10 }), at90)).toBe('lupa')
  })
  it('I-4: ferramenta em alerta por outra janela (semanal) não é substituta', () => {
    const s = snap({ opencode: 95, claude: 20 })
    expect(pickReplacement('curinga', ALL, s, at90)).toBeDefined()
    s.rows.find(r => r.tool === 'claude')!.alert = true
    expect(pickReplacement('curinga', ALL, s, at90)).toBeUndefined()
  })
  it('ninguém de outra ferramenta com folga → undefined', () => {
    expect(pickReplacement('forja', ALL, snap({ claude: 92, opencode: 95 }), at90)).toBeUndefined()
    expect(pickReplacement('forja', ['forja', 'pincel', 'bussola'], snap({ claude: 92 }), at90)).toBeUndefined()
  })
  it('entre vários com folga, a ferramenta menos usada vence', () => {
    expect(pickReplacement('radar', ['radar', 'lupa'], snap({ gemini: 95, codex: 80 }), at90)).toBe('lupa')
  })

  it('substituto vem do mesmo perfil de quem parou', () => {
    registerAgents(resolveAgentDefs({ id: 'hp', nome: 'H', builtin: false, defaults: { transport: { kind: 'cli', tool: 'claude' } }, agents: [
      { id: 'h1', nome: 'H1', prompt: '', funcao: 'Back-end', readOnly: false, reviewer: false, consultable: false },
      { id: 'h2', nome: 'H2', prompt: '', funcao: 'Back-end', readOnly: false, reviewer: false, consultable: false, transport: { kind: 'cli', tool: 'opencode' } },
    ] }))
    expect(pickReplacement('h1', [...ALL, 'h1', 'h2'], snap({ claude: 95 }), at90)).toBe('h2')
  })
})

