import { AGENTS, type AgentId, type ToolKind } from '@shared/agents'
import type { ToolStatus } from '@shared/models'
import type { ChatState, RunBlock } from '../state/chat'

// O que cada mascote mostra no palco, derivado só do estado do chat (spec §9.1).

export type Pose = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'locked'
export interface MascotView { pose: Pose; label: string; bubble?: string; bubbleKind?: 'dots' | 'text' | 'alert' }

export const DONE_BUBBLE_MS = 4000

const IDLE: MascotView = { pose: 'idle', label: 'Disponível' }
const VERB: Record<string, string> = {
  Bash: 'Rodando', Shell: 'Rodando', Edit: 'Editando', Write: 'Editando', MultiEdit: 'Editando',
  NotebookEdit: 'Editando', Read: 'Lendo', Glob: 'Lendo', Grep: 'Lendo',
}

/** Uma linha só, sem cercas de código, no máximo `max` caracteres. */
export function bubbleText(raw: string, max = 60): string {
  const line = raw.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).find(l => l && !l.startsWith('```')) ?? ''
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

function viewFor(run: RunBlock | undefined, now: number): MascotView {
  if (!run) return IDLE
  if (run.status === 'running') {
    if (run.questions.some(q => q.answer === undefined)) return { pose: 'waiting', label: 'Esperando você', bubble: 'Tenho uma pergunta', bubbleKind: 'alert' }
    const pending = run.approvals.find(a => a.allowed === undefined)
    if (pending) return { pose: 'waiting', label: 'Esperando você', bubble: bubbleText(`Preciso da sua aprovação: ${pending.summary}`), bubbleKind: 'alert' }
    const last = run.steps.at(-1)
    if (!last) return { pose: 'thinking', label: 'Pensando', bubbleKind: 'dots' }
    return { pose: 'working', label: 'Trabalhando', bubble: bubbleText(`${VERB[last.name] ?? last.name} ${last.summary}`), bubbleKind: 'text' }
  }
  const recent = run.finishedAt !== undefined && now - run.finishedAt <= DONE_BUBBLE_MS
  if (!recent || run.status === 'interrupted') return IDLE
  if (run.status === 'done') return { pose: 'done', label: 'Concluído', bubble: bubbleText(run.text) || 'Pronto.', bubbleKind: 'text' }
  if (run.status === 'error') return { ...IDLE, bubble: bubbleText(`Deu erro: ${run.error ?? 'falha desconhecida'}`), bubbleKind: 'alert' }
  return { ...IDLE, bubble: 'Cancelado.', bubbleKind: 'text' }
}

/** `tools` ausente = ainda carregando: ninguém fica travado. */
export function deriveStage(chat: ChatState, now: number, tools?: Record<ToolKind, ToolStatus>): Record<AgentId, MascotView> {
  return Object.fromEntries(AGENTS.map(a => {
    const t = tools?.[a.tool]
    if (t && !(t.installed && t.loggedIn)) return [a.id, { pose: 'locked', label: t.hint ?? 'Indisponível' }]
    const last = chat.runs.filter(r => r.agentId === a.id).at(-1)
    return [a.id, viewFor(last, now)]
  })) as Record<AgentId, MascotView>
}
