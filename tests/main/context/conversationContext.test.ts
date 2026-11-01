import { describe, expect, it } from 'vitest'
import type { AgentId } from '@shared/agents'
import type { RunEvent } from '@shared/events'
import { openStore, type Store } from '../../../src/main/store/db'
import { buildContext, collectEntries, type ContextEntry } from '../../../src/main/context/conversationContext'

function conv() {
  const store = openStore(':memory:')
  const c = store.createConversation(store.upsertProject('/p').id, 't')
  let t = 0
  const run = (id: string, agentId: AgentId, prompt: string, evs: RunEvent[], parentRunId?: string) => {
    store.createRun({ id, conversationId: c.id, agentId, prompt, startedAt: ++t * 10, hasCheckpoint: true, ...(parentRunId ? { parentRunId } : {}) })
    for (const ev of evs) store.appendEvent(id, ev)
    store.finishRun(id, 'done')
  }
  return { store, c, run }
}
const kinds = (es: ContextEntry[]) => es.map(e => [e.kind, e.who, e.text])

describe('collectEntries', () => {
  it('pedidos, respostas, consultas e resumo do time — sem triagem, confirmações nem passos', () => {
    const { store, c, run } = conv()
    run('r1', 'forja', 'Crie a rota', [{ type: 'run_started', runId: 'r1', agentId: 'forja' }, { type: 'tool', name: 'Edit', summary: 'a.ts' }, { type: 'text', text: 'Criei a rota.' },
      { type: 'agent_call', from: 'forja', to: 'radar', question: 'versão?' }, { type: 'agent_call_answer', from: 'forja', to: 'radar', answer: 'Node 26' }])
    run('r2', 'radar', 'O que acha?', [{ type: 'text', text: 'Está ok.' }])
    run('pai', 'bussola', 'Faça o time', [{ type: 'team_started' }, { type: 'triage', scores: [], candidates: ['forja'] },
      { type: 'confirmation', confirmation: { agentId: 'forja', decision: 'assumo', line: 'eu' } },
      { type: 'lineup', big: false, waves: [[0]], lineup: { summary: 'Forja faz a página.', big: false, steps: [{ agentId: 'forja', task: 'x', areas: [] }] } },
      { type: 'diff', files: [{ path: 'web/a.html', status: 'A', added: 1, removed: 0 }] }])
    run('filho', 'forja', 'Sua parte: x', [{ type: 'text', text: 'Fiz a página.' }], 'pai')
    expect(kinds(collectEntries(store, c.id))).toEqual([
      ['pedido', 'natan', 'Crie a rota'],
      ['resposta', 'forja', 'Criei a rota.'],
      ['consulta', 'forja', 'Forja perguntou ao Radar: versão?\nRadar: Node 26'],
      ['pedido', 'natan', 'O que acha?'],
      ['resposta', 'radar', 'Está ok.'],
      ['pedido', 'natan', 'Faça o time'],
      ['time', 'bussola', 'Forja faz a página.\nArquivos alterados: web/a.html'],
      ['resposta', 'forja', 'Fiz a página.'],
    ])
  })

  it('ignora pedidos ainda em andamento ou na fila', () => {
    const { store, c, run } = conv()
    run('r1', 'forja', 'pronto', [{ type: 'text', text: 'ok' }])
    store.createRun({ id: 'fila', conversationId: c.id, agentId: 'pincel', prompt: 'na fila', startedAt: 999, hasCheckpoint: true })
    expect(collectEntries(store, c.id).map(e => e.text)).toEqual(['pronto', 'ok'])
  })

  it('pode excluir o run atual', () => {
    const { store, c, run } = conv()
    run('r1', 'forja', 'um', [{ type: 'text', text: 'ok' }])
    run('r2', 'radar', 'dois', [])
    expect(collectEntries(store, c.id, 'r2').map(e => e.text)).toEqual(['um', 'ok'])
  })
})

describe('buildContext', () => {
  const e = (at: number, who: ContextEntry['who'], text: string, kind: ContextEntry['kind'] = 'resposta'): ContextEntry => ({ at, who, kind, text })

  it('o Gemini sabe o que o Claude disse', () => {
    const out = buildContext([e(1, 'natan', 'Qual framework?', 'pedido'), e(2, 'forja', 'Use Fastify.')], { forAgent: 'radar' })
    expect(out).toContain('Qual framework?')
    expect(out).toContain('Forja')
    expect(out).toContain('Use Fastify.')
  })

  it('retomando sessão: só o que veio depois e não é dele', () => {
    const out = buildContext([e(1, 'forja', 'antigo'), e(5, 'forja', 'meu novo'), e(6, 'pincel', 'do Pincel'), e(7, 'natan', 'pedido novo', 'pedido')], { forAgent: 'forja', sinceAt: 4 })
    expect(out).not.toContain('antigo')
    expect(out).not.toContain('meu novo')
    expect(out).toContain('do Pincel')
    expect(out).toContain('pedido novo')
  })

  it('vazio quando não há nada', () => expect(buildContext([], { forAgent: 'forja' })).toBe(''))

  it('conversa longa respeita o teto e mantém as mais recentes', () => {
    const many = Array.from({ length: 200 }, (_, i) => e(i, 'pincel', `msg-${i} ` + 'x'.repeat(490)))
    const out = buildContext(many, { forAgent: 'forja', maxChars: 24_000 })
    expect(out.length).toBeLessThanOrEqual(24_000)
    expect(out).toContain('msg-199 ')
    expect(out).toMatch(/\(… \d+ mensagens anteriores omitidas\)/)
  })

  it('entrada enorme é cortada em 4.000 caracteres', () => {
    const out = buildContext([e(1, 'pincel', 'y'.repeat(10_000))], { forAgent: 'forja' })
    expect(out).toContain('y'.repeat(4000) + '…')
    expect(out).not.toContain('y'.repeat(4001))
  })

  it('resumo do time sai em nome do coordenador do perfil', () => {
    const store = openStore(':memory:')
    const conv = store.createConversation(store.upsertProject('/p').id, 't')
    store.createRun({ id: 'pai', conversationId: conv.id, agentId: 'chefe', prompt: 'Faça', startedAt: 1, hasCheckpoint: true })
    store.appendEvent('pai', { type: 'team_started' })
    store.appendEvent('pai', { type: 'lineup', lineup: { summary: 'Kimi faz.', big: false, steps: [] }, waves: [], big: false })
    store.finishRun('pai', 'done')
    expect(collectEntries(store, conv.id).map(e => [e.kind, e.who])).toContainEqual(['time', 'chefe'])
  })
})

