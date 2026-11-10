import { describe, expect, it } from 'vitest'
import type { UsageSnapshot } from '@shared/usage'
import { bar, colorFor, placar, placarWidth } from '../../src/cli/placar'

const row = (tool: string, utilization: number | null, extra: object = {}) =>
  ({ tool, utilization, estimated: false, window: 'five_hour', tokens: { input: 0, output: 0, cacheRead: 0, reasoning: 0 }, alert: false, ...extra })
const snap = (rows: object[]): UsageSnapshot => ({ rows: rows as never, at: 0 })
const AGENTS = [{ nome: 'Bússola', tool: 'claude' }, { nome: 'Forja', tool: 'codex' }, { nome: 'Lupa', tool: 'codex' }, { nome: 'Curinga', tool: 'opencode' }] as const
const now = new Date(2026, 10, 13, 10, 0).getTime() // sexta
const segunda = new Date(2026, 10, 16, 9, 0).getTime()

describe('placar', () => {
  it('barra cheia do jeito do esboço', () => {
    expect(bar(68, 15)).toBe('██████████░░░░░')
    expect(bar(0, 4)).toBe('░░░░')
    expect(bar(100, 4)).toBe('████')
  })
  it('cor por faixa: verde até 60, amarelo até 85, vermelho acima, cinza sem dado', () => {
    expect([colorFor(60), colorFor(61), colorFor(85), colorFor(86), colorFor(null)]).toEqual(['green', 'yellow', 'yellow', 'red', 'gray'])
  })
  it('esgotado mostra quando volta; estimado leva ~; sem dado mostra —', () => {
    const p = placar('Tutti · app', AGENTS, snap([row('claude', 100, { resetsAt: segunda }), row('codex', 12, { estimated: true }), row('opencode', null)]), 200, now)
    expect(p.cells[0].text).toContain('esgotado · seg')
    expect(p.cells[0].color).toBe('red')
    expect(p.cells[1].text).toContain('~12%')
    expect(p.cells[3].text).toContain('—')
    expect(p.cells[3].color).toBe('gray')
  })
  it('largo: barra de 15', () => {
    const p = placar('Tutti · app', AGENTS, snap([row('claude', 68), row('codex', 27)]), 200, now)
    expect(p.cells[0].text).toBe('██████████░░░░░  68%')
  })
  it('sexta a 80 colunas: dois esgotados ainda cabem e a reserva aparece', () => {
    const p = placar('Tutti · minha-api', AGENTS, snap([row('claude', 100, { resetsAt: segunda }), row('codex', 100, { resetsAt: segunda }), row('opencode', 10)]), 80, now)
    expect(placarWidth(p)).toBeLessThanOrEqual(80)
    expect(p.cells[3].text).toContain('10%')
    expect(p.cells[0].text).toContain('seg')
  })
  it('100 colunas com o Claude esgotado: os nomes continuam inteiros', () => {
    const p = placar('Tutti · calculadora', AGENTS, snap([row('claude', 100, { resetsAt: segunda }), row('codex', 7), row('opencode', null)]), 100, now)
    expect(placarWidth(p)).toBeLessThanOrEqual(100)
    expect(p.cells.map(c => c.nome)).toEqual(['Bússola', 'Forja', 'Lupa', 'Curinga'])
  })

  it('80 colunas: continua numa linha só', () => {
    const p = placar('Tutti · minha-api', AGENTS, snap([row('claude', 68), row('codex', 27), row('opencode', 0)]), 80, now)
    expect(placarWidth(p)).toBeLessThanOrEqual(80)
  })
})
