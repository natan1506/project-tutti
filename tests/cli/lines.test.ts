import { describe, expect, it } from 'vitest'
import { eventLine } from '../../src/cli/lines'

const nome = (id: string) => ({ forja: 'Forja', curinga: 'Curinga' }[id] ?? id)

describe('linhas da conversa', () => {
  it('troca do cérebro em amarelo, começando com ↪', () => {
    const l = eventLine({ type: 'esteira_swap', role: 'executor', from: 'forja', to: 'curinga', reason: 'Forja indisponível' }, nome)!
    expect(l.text.startsWith('↪ ')).toBe(true)
    expect(l.text).toContain('Curinga assume')
    expect(l.color).toBe('yellow')
  })
  it('passo iniciado: nome e tarefa', () => {
    expect(eventLine({ type: 'child_started', runId: 'c', agentId: 'forja', task: 'Criar soma.js' }, nome)!.text).toBe('Forja  Criar soma.js')
  })
  it('uso e eventos internos não viram linha', () => {
    expect(eventLine({ type: 'usage', tool: 'claude', tokens: { input: 1, output: 1, cacheRead: 0, reasoning: 0 } }, nome)).toBeNull()
    expect(eventLine({ type: 'team_started' }, nome)).toBeNull()
  })
  it('revisão pronta em verde; com falta em amarelo', () => {
    expect(eventLine({ type: 'esteira_review', volta: 0, pronto: true, falta: '' }, nome)).toMatchObject({ color: 'green' })
    expect(eventLine({ type: 'esteira_review', volta: 0, pronto: false, falta: 'X' }, nome)).toMatchObject({ text: 'Revisão: falta X', color: 'yellow' })
  })
})
