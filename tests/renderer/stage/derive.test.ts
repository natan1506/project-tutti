import { describe, expect, it } from 'vitest'
import type { RunEvent } from '@shared/events'
import type { ToolKind } from '@shared/agents'
import type { RunRow, ToolStatus } from '@shared/models'
import { applyEvent, chatFromHistory, emptyChat, type ChatState } from '../../../src/renderer/state/chat'
import { bubbleText, deriveStage, DONE_BUBBLE_MS } from '../../../src/renderer/stage/derive'

const NOW = 1_000_000
const TOOLS = (over: Partial<Record<ToolKind, Partial<ToolStatus>>> = {}): Record<ToolKind, ToolStatus> =>
  Object.fromEntries((['claude', 'codex', 'gemini', 'opencode'] as const).map(t => [t, { tool: t, installed: true, loggedIn: true, ...over[t] }])) as Record<ToolKind, ToolStatus>
const play = (evs: RunEvent[], finishedAt?: number): ChatState => {
  let s = applyEvent(emptyChat(), 'r1', { type: 'run_started', runId: 'r1', agentId: 'forja' })
  for (const ev of evs) s = applyEvent(s, 'r1', ev)
  return finishedAt === undefined ? s : { ...s, runs: s.runs.map(r => ({ ...r, finishedAt })) }
}

describe('deriveStage', () => {
  it('sem status das ferramentas (carregando), ninguém fica travado', () => {
    const v = deriveStage(emptyChat(), NOW)
    expect(v.radar.pose).toBe('idle')
    expect(v.curinga.pose).toBe('idle')
  })

  it('ferramenta indisponível trava o agente com a instrução', () => {
    const v = deriveStage(emptyChat(), NOW, TOOLS({ gemini: { installed: false, loggedIn: false, hint: 'Instale o Antigravity' } }))
    expect(v.radar).toEqual({ pose: 'locked', label: 'Instale o Antigravity' })
    expect(v.forja.pose).toBe('idle')
  })

  it('sem pedido fica disponível sem balão', () => {
    expect(deriveStage(emptyChat(), NOW).forja).toEqual({ pose: 'idle', label: 'Disponível' })
  })

  it('pedido começou e ainda não fez nada: pensando', () => {
    expect(deriveStage(play([]), NOW).forja).toEqual({ pose: 'thinking', label: 'Pensando', bubbleKind: 'dots' })
  })

  it.each([
    ['Bash', 'npm test', 'Rodando npm test'],
    ['Shell', 'ls', 'Rodando ls'],
    ['Edit', 'src/a.ts', 'Editando src/a.ts'],
    ['Write', 'src/b.ts', 'Editando src/b.ts'],
    ['Read', 'src/c.ts', 'Lendo src/c.ts'],
    ['Grep', 'foo', 'Lendo foo'],
    ['TodoWrite', 'plano', 'TodoWrite plano'],
  ])('trabalhando mostra o último passo (%s)', (name, summary, bubble) => {
    const s = play([{ type: 'tool', name: 'Read', summary: 'x' }, { type: 'tool', name, summary }])
    expect(deriveStage(s, NOW).forja).toEqual({ pose: 'working', label: 'Trabalhando', bubble, bubbleKind: 'text' })
  })

  it('aprovação pendente: esperando você com alerta', () => {
    const s = play([{ type: 'approval_request', id: 'p', toolName: 'Bash', summary: 'npm install x' }])
    expect(deriveStage(s, NOW).forja).toEqual({
      pose: 'waiting', label: 'Esperando você', bubble: 'Preciso da sua aprovação: npm install x', bubbleKind: 'alert',
    })
  })

  it('pergunta pendente: esperando você com "Tenho uma pergunta"', () => {
    const s = play([{ type: 'question', id: 'q', text: 'Qual nome?' }])
    expect(deriveStage(s, NOW).forja).toEqual({ pose: 'waiting', label: 'Esperando você', bubble: 'Tenho uma pergunta', bubbleKind: 'alert' })
  })

  it('aprovação respondida volta a trabalhar', () => {
    const s = play([
      { type: 'approval_request', id: 'p', toolName: 'Bash', summary: 'npm i' },
      { type: 'approval_resolved', id: 'p', allowed: true },
    ])
    expect(deriveStage(s, NOW).forja.pose).not.toBe('waiting')
  })

  it('concluído recente mostra a primeira linha da resposta', () => {
    const s = play([{ type: 'text', text: '\nFeito: rota criada.\nDetalhes...' }, { type: 'run_finished', status: 'done' }], NOW - 1000)
    expect(deriveStage(s, NOW).forja).toEqual({ pose: 'done', label: 'Concluído', bubble: 'Feito: rota criada.', bubbleKind: 'text' })
  })

  it('concluído sem texto diz Pronto.', () => {
    const s = play([{ type: 'run_finished', status: 'done' }], NOW - 1000)
    expect(deriveStage(s, NOW).forja.bubble).toBe('Pronto.')
  })

  it('concluído antigo volta a disponível', () => {
    const s = play([{ type: 'run_finished', status: 'done' }], NOW - DONE_BUBBLE_MS - 1)
    expect(deriveStage(s, NOW).forja).toEqual({ pose: 'idle', label: 'Disponível' })
  })

  it('erro recente mostra alerta', () => {
    const s = play([{ type: 'error', message: 'limite' }, { type: 'run_finished', status: 'error' }], NOW - 1000)
    expect(deriveStage(s, NOW).forja).toEqual({ pose: 'idle', label: 'Disponível', bubble: 'Deu erro: limite', bubbleKind: 'alert' })
  })

  it('cancelado recente avisa', () => {
    const s = play([{ type: 'run_finished', status: 'cancelled' }], NOW - 1000)
    expect(deriveStage(s, NOW).forja).toEqual({ pose: 'idle', label: 'Disponível', bubble: 'Cancelado.', bubbleKind: 'text' })
  })

  it('pedido interrompido de uma conversa reaberta não prende o mascote', () => {
    const row: RunRow = { id: 'r1', conversationId: 'c', agentId: 'forja', prompt: 'x', status: 'interrupted', sessionId: null, startedAt: 1, finishedAt: NOW - 10_000, hasCheckpoint: true }
    const s = chatFromHistory([row], { r1: [{ type: 'run_started', runId: 'r1', agentId: 'forja' }, { type: 'tool', name: 'Bash', summary: 'ls' }] })
    expect(deriveStage(s, NOW).forja).toEqual({ pose: 'idle', label: 'Disponível' })
  })

  it('usa o último pedido do agente', () => {
    let s = play([{ type: 'run_finished', status: 'done' }], NOW - 1000)
    s = applyEvent(s, 'r2', { type: 'run_started', runId: 'r2', agentId: 'forja' })
    expect(deriveStage(s, NOW).forja.pose).toBe('thinking')
  })
})

describe('bubbleText', () => {
  it('pega só a primeira linha', () => expect(bubbleText('linha 1\nlinha 2')).toBe('linha 1'))
  it('corta em 60 com reticências', () => {
    const out = bubbleText('a'.repeat(80))
    expect(out).toBe('a'.repeat(59) + '…')
    expect(out).toHaveLength(60)
  })
  it('ignora cerca de código', () => expect(bubbleText('```ts\ncode')).toBe('code'))
  it('colapsa espaços', () => expect(bubbleText('  a   b  ')).toBe('a b'))
})
