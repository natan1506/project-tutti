import type { ApprovalReason } from '@shared/autonomy'
import { AGENTS, type AgentId } from '@shared/agents'
import type { DiffFile, RunEvent, RunStatus } from '@shared/events'
import type { RunRow } from '@shared/models'
import type { Confirmation, Lineup, TriageScore } from '@shared/team'

export type AgentStatus = 'disponivel' | 'trabalhando' | 'esperando' | 'concluido'

export interface Approval { id: string; toolName: string; summary: string; reason?: ApprovalReason; allowed?: boolean }
export interface LimitWarning { id: string; tool: import('@shared/agents').ToolKind; window: import('@shared/usage').WindowKind; utilization: number; to?: AgentId; paid?: { provider: string }; pass?: boolean }
export interface AgentCall { to: AgentId; question: string; answer?: string }
export interface Question { id: string; text: string; options?: string[]; answer?: string | null }
export interface RunBlock {
  runId: string
  agentId: AgentId
  prompt: string
  text: string
  steps: { name: string; summary: string }[]
  approvals: Approval[]
  questions: Question[]
  files?: DiffFile[]
  status: RunStatus
  error?: string
  notices: string[]
  calls: AgentCall[]
  limitWarnings: LimitWarning[]
  handoff?: { to: AgentId; newRunId: string }
  startedAt: number
  /** Pedido de time (run-pai do Bússola). */
  team?: boolean
  parentRunId?: string
  children: string[]
  queued?: number
  triage?: { scores: TriageScore[]; candidates: AgentId[] }
  confirmations: Confirmation[]
  lineup?: Lineup
  waves?: number[][]
  big?: boolean
  plan?: { id: string; approved?: boolean }
  finishedAt?: number
}
export interface ChatState { runs: RunBlock[]; agentStatus: Record<AgentId, AgentStatus> }

export function emptyChat(): ChatState {
  return { runs: [], agentStatus: Object.fromEntries(AGENTS.map(a => [a.id, 'disponivel'])) as Record<AgentId, AgentStatus> }
}

/** Reducer puro: aplica um evento do processo principal ao estado do chat. */
export function applyEvent(state: ChatState, runId: string, ev: RunEvent): ChatState {
  if (ev.type === 'run_started') {
    const block: RunBlock = { runId, agentId: ev.agentId, prompt: '', text: '', steps: [], approvals: [], questions: [], notices: [], calls: [], limitWarnings: [], children: [], confirmations: [], status: 'running', startedAt: Date.now() }
    return { runs: [...state.runs, block], agentStatus: { ...state.agentStatus, [ev.agentId]: 'trabalhando' } }
  }
  const run = state.runs.find(r => r.runId === runId)
  if (!run) return state
  // Qualquer evento além de `queued` significa que o pedido saiu da fila.
  const base = ev.type !== 'queued' && run.queued !== undefined ? { ...run, queued: undefined } : run
  const set = (patch: Partial<RunBlock>, status?: AgentStatus): ChatState => ({
    runs: state.runs.map(r => (r === run ? { ...base, ...patch } : r)),
    agentStatus: status ? { ...state.agentStatus, [run.agentId]: status } : state.agentStatus,
  })
  switch (ev.type) {
    case 'text': return set({ text: run.text ? `${run.text}\n\n${ev.text}` : ev.text })
    case 'tool': return set({ steps: [...run.steps, { name: ev.name, summary: ev.summary }] })
    case 'approval_request':
      return set({ approvals: [...run.approvals, { id: ev.id, toolName: ev.toolName, summary: ev.summary, ...(ev.reason ? { reason: ev.reason } : {}) }] }, 'esperando')
    case 'approval_resolved':
      return set({ approvals: run.approvals.map(a => (a.id === ev.id ? { ...a, allowed: ev.allowed } : a)) }, 'trabalhando')
    case 'question':
      return set({ questions: [...run.questions, { id: ev.id, text: ev.text, ...(ev.options ? { options: ev.options } : {}) }] }, 'esperando')
    case 'question_answered':
      return set({ questions: run.questions.map(q => (q.id === ev.id ? { ...q, answer: ev.answer } : q)) }, 'trabalhando')
    case 'error': return set({ error: ev.message })
    case 'notice': return set({ notices: [...run.notices, ev.text] })
    case 'queued': return set({ queued: ev.position > 0 ? ev.position : undefined })
    case 'limit_warning':
      return set({ limitWarnings: [...run.limitWarnings, { id: ev.id, tool: ev.tool, window: ev.window, utilization: ev.utilization, ...(ev.to ? { to: ev.to } : {}), ...(ev.paid ? { paid: ev.paid } : {}) }] }, 'esperando')
    case 'limit_resolved':
      return set({ limitWarnings: run.limitWarnings.map(w => (w.id === ev.id ? { ...w, pass: ev.pass } : w)) }, 'trabalhando')
    case 'handoff': return set({ handoff: { to: ev.to, newRunId: ev.newRunId } })
    case 'team_started': return set({ team: true })
    case 'triage': return set({ triage: { scores: ev.scores, candidates: ev.candidates } })
    case 'confirmation': return set({ confirmations: [...run.confirmations, ev.confirmation] })
    case 'lineup': return set({ lineup: ev.lineup, waves: ev.waves, big: ev.big })
    case 'plan_request': return set({ plan: { id: ev.id } }, 'esperando')
    case 'plan_resolved': return set({ plan: { id: ev.id, approved: ev.approved } }, 'trabalhando')
    case 'child_started': {
      const next = set({ children: [...run.children, ev.runId] })
      return { ...next, runs: next.runs.map(r => (r.runId === ev.runId ? { ...r, parentRunId: runId } : r)) }
    }
    case 'agent_call': return set({ calls: [...run.calls, { to: ev.to, question: ev.question }] })
    case 'agent_call_answer':
      return set({ calls: run.calls.map(c => (c.to === ev.to && c.answer === undefined ? { ...c, answer: ev.answer } : c)) })
    case 'diff': return set({ files: ev.files })
    case 'run_finished':
      return set({ status: ev.status, finishedAt: Date.now() }, ev.status === 'done' ? 'concluido' : 'disponivel')
    default: return state
  }
}

/** Reconstrói o chat de uma conversa salva; o status e os tempos gravados no banco prevalecem sobre os eventos. */
export function chatFromHistory(runs: RunRow[], events: Record<string, RunEvent[]>): ChatState {
  let chat = emptyChat()
  for (const r of runs) for (const ev of events[r.id] ?? []) chat = applyEvent(chat, r.id, ev)
  const rows = new Map(runs.map(r => [r.id, r]))
  return {
    // Ao reabrir, ninguém está trabalhando: o estado dos mascotes começa do zero.
    agentStatus: emptyChat().agentStatus,
    runs: chat.runs.map(b => {
      const r = rows.get(b.runId)!
      return { ...b, prompt: r.prompt, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt ?? undefined, ...(r.parentRunId ? { parentRunId: r.parentRunId } : {}) }
    }),
  }
}

export function withPrompt(state: ChatState, runId: string, prompt: string): ChatState {
  return { ...state, runs: state.runs.map(r => (r.runId === runId ? { ...r, prompt } : r)) }
}
