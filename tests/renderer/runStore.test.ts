import { describe, expect, it } from 'vitest'
import type { RunEvent } from '@shared/events'
import { applyEvent, emptyChat, type ChatState } from '../../src/renderer/state/chat'

const play = (evs: [string, RunEvent][], s: ChatState = emptyChat()) => evs.reduce((st, [id, ev]) => applyEvent(st, id, ev), s)
const started = (id = 'r1'): [string, RunEvent] => [id, { type: 'run_started', runId: id, agentId: 'forja' }]

describe('applyEvent', () => {
  it('run_started cria o bloco e põe o agente trabalhando', () => {
    const s = play([started()])
    expect(s.runs).toHaveLength(1)
    expect(s.runs[0]).toMatchObject({ runId: 'r1', agentId: 'forja', status: 'running', text: '', steps: [] })
    expect(s.agentStatus.forja).toBe('trabalhando')
    expect(s.agentStatus.pincel).toBe('disponivel')
  })

  it('texto acumula e passos contam', () => {
    const s = play([started(), ['r1', { type: 'text', text: 'a' }], ['r1', { type: 'tool', name: 'Bash', summary: 'ls' }], ['r1', { type: 'text', text: 'b' }]])
    expect(s.runs[0].text).toBe('a\n\nb')
    expect(s.runs[0].steps).toEqual([{ name: 'Bash', summary: 'ls' }])
  })

  it('aprovação pendente põe o agente esperando e resolvida volta a trabalhando', () => {
    let s = play([started(), ['r1', { type: 'approval_request', id: 'p1', toolName: 'Bash', summary: 'rm x' }]])
    expect(s.runs[0].approvals).toEqual([{ id: 'p1', toolName: 'Bash', summary: 'rm x' }])
    expect(s.agentStatus.forja).toBe('esperando')
    s = applyEvent(s, 'r1', { type: 'approval_resolved', id: 'p1', allowed: false })
    expect(s.runs[0].approvals[0]).toMatchObject({ id: 'p1', allowed: false })
    expect(s.agentStatus.forja).toBe('trabalhando')
  })

  it('diff e fim com sucesso', () => {
    const files = [{ path: 'a.ts', status: 'A' as const, added: 1, removed: 0 }]
    const s = play([started(), ['r1', { type: 'diff', files }], ['r1', { type: 'run_finished', status: 'done' }]])
    expect(s.runs[0].files).toEqual(files)
    expect(s.runs[0].status).toBe('done')
    expect(s.agentStatus.forja).toBe('concluido')
  })

  it.each(['cancelled', 'error'] as const)('fim %s deixa o agente disponível', status => {
    const s = play([started(), ['r1', { type: 'run_finished', status }]])
    expect(s.runs[0].status).toBe(status)
    expect(s.agentStatus.forja).toBe('disponivel')
  })

  it('erro fica guardado no bloco', () => {
    expect(play([started(), ['r1', { type: 'error', message: 'limite' }]]).runs[0].error).toBe('limite')
  })

  it('eventos de outro run não interferem', () => {
    const s = play([started('r1'), started('r2'), ['r2', { type: 'text', text: 'só r2' }]])
    expect(s.runs.find(r => r.runId === 'r1')!.text).toBe('')
    expect(s.runs.find(r => r.runId === 'r2')!.text).toBe('só r2')
  })

  it('evento de run desconhecido é ignorado', () => {
    const s0 = emptyChat()
    expect(applyEvent(s0, 'x', { type: 'text', text: 'a' })).toBe(s0)
  })
})
