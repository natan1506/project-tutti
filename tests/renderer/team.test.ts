import { describe, expect, it } from 'vitest'
import type { RunEvent } from '@shared/events'
import { applyEvent, emptyChat, type ChatState } from '../../src/renderer/state/chat'
import { deriveStage } from '../../src/renderer/stage/derive'

const P = 'pai'
const play = (evs: [string, RunEvent][], s: ChatState = emptyChat()) => evs.reduce((st, [id, ev]) => applyEvent(st, id, ev), s)
const parentStart: [string, RunEvent][] = [[P, { type: 'run_started', runId: P, agentId: 'bussola' }], [P, { type: 'team_started' }]]
const TRIAGE: [string, RunEvent] = [P, { type: 'triage', candidates: ['forja', 'pincel'], scores: [
  { agentId: 'forja', score: 93, line: 'Comigo.' }, { agentId: 'pincel', score: 76, line: 'Tela é minha.' }, { agentId: 'lupa', score: 30, line: 'Reviso depois.' },
] }]
const LINEUP: [string, RunEvent] = [P, { type: 'lineup', big: false, waves: [[0, 1]], lineup: { summary: 'Forja e Pincel.', big: false, steps: [
  { agentId: 'forja', task: 'api', areas: ['server'] }, { agentId: 'pincel', task: 'tela', areas: ['web'] },
] } }]

describe('chat do time', () => {
  it('guarda triagem, confirmações (frase do próprio agente), escalação e fila', () => {
    let s = play([...parentStart, [P, { type: 'queued', position: 1 }]])
    expect(s.runs[0]).toMatchObject({ team: true, queued: 1 })
    s = play([TRIAGE, [P, { type: 'confirmation', confirmation: { agentId: 'forja', decision: 'assumo', line: 'Assumo o endpoint.' } }], LINEUP], s)
    const b = s.runs[0]
    expect(b.queued).toBeUndefined()
    expect(b.triage?.candidates).toEqual(['forja', 'pincel'])
    expect(b.confirmations).toEqual([{ agentId: 'forja', decision: 'assumo', line: 'Assumo o endpoint.' }])
    expect(b.lineup?.summary).toBe('Forja e Pincel.')
    expect(b.waves).toEqual([[0, 1]])
  })

  it('plano pendente deixa o Bússola esperando; resposta volta', () => {
    let s = play([...parentStart, TRIAGE, LINEUP, [P, { type: 'plan_request', id: 'pl' }]])
    expect(s.runs[0].plan).toEqual({ id: 'pl' })
    expect(s.agentStatus.bussola).toBe('esperando')
    s = applyEvent(s, P, { type: 'plan_resolved', id: 'pl', approved: true })
    expect(s.runs[0].plan).toEqual({ id: 'pl', approved: true })
    expect(s.agentStatus.bussola).toBe('trabalhando')
  })

  it('filho fica ligado ao pai; chamadas entre agentes ficam no bloco de quem perguntou', () => {
    const s = play([...parentStart, ['c1', { type: 'run_started', runId: 'c1', agentId: 'forja' }],
      [P, { type: 'child_started', runId: 'c1', agentId: 'forja', task: 'api' }],
      ['c1', { type: 'agent_call', from: 'forja', to: 'radar', question: 'versão?' }],
      ['c1', { type: 'agent_call_answer', from: 'forja', to: 'radar', answer: 'Node 26' }]])
    expect(s.runs.find(r => r.runId === P)!.children).toEqual(['c1'])
    expect(s.runs.find(r => r.runId === 'c1')!.parentRunId).toBe(P)
    expect(s.runs.find(r => r.runId === 'c1')!.calls).toEqual([{ to: 'radar', question: 'versão?', answer: 'Node 26' }])
  })
})

describe('palco do time', () => {
  it('antes da triagem, todo mundo pensa', () => {
    const v = deriveStage(play(parentStart), 0)
    for (const id of ['bussola', 'forja', 'pincel', 'radar', 'lupa', 'curinga'] as const) expect(v[id]).toMatchObject({ pose: 'thinking', bubbleKind: 'dots' })
  })

  it('na confirmação: candidatos pensam, quem já confirmou mostra a própria frase, os outros a da triagem', () => {
    const v = deriveStage(play([...parentStart, TRIAGE, [P, { type: 'confirmation', confirmation: { agentId: 'forja', decision: 'assumo', line: 'Assumo o endpoint.' } }]]), 0)
    expect(v.forja).toMatchObject({ pose: 'idle', bubble: 'Assumo o endpoint.' })
    expect(v.pincel).toMatchObject({ pose: 'thinking', bubbleKind: 'dots' })
    expect(v.lupa).toMatchObject({ pose: 'idle', bubble: 'Reviso depois.' })
  })

  it('plano pendente: Bússola espera aprovação', () => {
    const v = deriveStage(play([...parentStart, TRIAGE, LINEUP, [P, { type: 'plan_request', id: 'pl' }]]), 0)
    expect(v.bussola).toEqual({ pose: 'waiting', label: 'Esperando você', bubble: 'Aprova o plano?', bubbleKind: 'alert' })
  })

  it('durante as ondas, os filhos seguem as regras de sempre', () => {
    const v = deriveStage(play([...parentStart, TRIAGE, LINEUP, ['c1', { type: 'run_started', runId: 'c1', agentId: 'forja' }],
      [P, { type: 'child_started', runId: 'c1', agentId: 'forja', task: 'api' }], ['c1', { type: 'tool', name: 'Edit', summary: 'server/a.js' }]]), 0)
    expect(v.forja).toMatchObject({ pose: 'working', bubble: 'Editando server/a.js' })
  })
  it('quem está sendo consultado aparece trabalhando, respondendo a quem perguntou', () => {
    const base: [string, RunEvent][] = [['c1', { type: 'run_started', runId: 'c1', agentId: 'forja' }], ['c1', { type: 'agent_call', from: 'forja', to: 'radar', question: 'versão?' }]]
    expect(deriveStage(play(base), 0).radar).toEqual({ pose: 'working', label: 'Trabalhando', bubble: 'Respondendo ao Forja', bubbleKind: 'text' })
    const answered = play([...base, ['c1', { type: 'agent_call_answer', from: 'forja', to: 'radar', answer: 'Node 26' }]])
    expect(deriveStage(answered, 0).radar.pose).toBe('idle')
  })
  it('I-2: pedido de time na fila não esconde o que está rodando; saiu da fila (posição 0) limpa a nota', () => {
    const s0 = play([...parentStart, TRIAGE, LINEUP, ['c1', { type: 'run_started', runId: 'c1', agentId: 'forja' }],
      [P, { type: 'child_started', runId: 'c1', agentId: 'forja', task: 'api' }], ['c1', { type: 'tool', name: 'Edit', summary: 'server/a.js' }],
      ['B', { type: 'run_started', runId: 'B', agentId: 'bussola' }], ['B', { type: 'team_started' }], ['B', { type: 'queued', position: 1 }]])
    expect(deriveStage(s0, 0).forja).toMatchObject({ pose: 'working' })
    const s1 = applyEvent(s0, 'B', { type: 'queued', position: 0 })
    expect(s1.runs.find(r => r.runId === 'B')!.queued).toBeUndefined()
  })
})

describe('esteira no app', () => {
  it('plano, troca e revisão aparecem como avisos do pedido', () => {
    const s = play([...parentStart,
      [P, { type: 'esteira_plan', volta: 0, plan: { tarefa: 'Criar soma.js', pronto: 'teste passa' } }],
      [P, { type: 'esteira_swap', role: 'executor', from: 'forja', to: 'curinga', reason: 'Forja indisponível: Ferramenta indisponível' }],
      [P, { type: 'esteira_review', volta: 0, pronto: false, falta: 'teste de negativos' }],
      [P, { type: 'esteira_review', volta: 1, pronto: true, falta: '' }],
    ])
    expect(s.runs[0].notices).toEqual([
      'Plano: Criar soma.js · Pronto quando: teste passa',
      '↪ Forja indisponível: Ferramenta indisponível — Curinga assume',
      'Revisão: falta teste de negativos',
      'Revisão: pronto',
    ])
  })
})
