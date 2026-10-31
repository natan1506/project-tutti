import { AGENTS, type AgentId } from '@shared/agents'
import type { DiffFile, RunEvent, RunStatus } from '@shared/events'

export type AgentStatus = 'disponivel' | 'trabalhando' | 'esperando' | 'concluido'

export interface Approval { id: string; toolName: string; summary: string; allowed?: boolean }
export interface RunBlock {
  runId: string
  agentId: AgentId
  prompt: string
  text: string
  steps: { name: string; summary: string }[]
  approvals: Approval[]
  files?: DiffFile[]
  status: RunStatus
  error?: string
  startedAt: number
  finishedAt?: number
}
export interface ChatState { runs: RunBlock[]; agentStatus: Record<AgentId, AgentStatus> }

export function emptyChat(): ChatState {
  return { runs: [], agentStatus: Object.fromEntries(AGENTS.map(a => [a.id, 'disponivel'])) as Record<AgentId, AgentStatus> }
}

/** Reducer puro: aplica um evento do processo principal ao estado do chat. */
export function applyEvent(state: ChatState, runId: string, ev: RunEvent): ChatState {
  if (ev.type === 'run_started') {
    const block: RunBlock = { runId, agentId: ev.agentId, prompt: '', text: '', steps: [], approvals: [], status: 'running', startedAt: Date.now() }
    return { runs: [...state.runs, block], agentStatus: { ...state.agentStatus, [ev.agentId]: 'trabalhando' } }
  }
  const run = state.runs.find(r => r.runId === runId)
  if (!run) return state
  const set = (patch: Partial<RunBlock>, status?: AgentStatus): ChatState => ({
    runs: state.runs.map(r => (r === run ? { ...r, ...patch } : r)),
    agentStatus: status ? { ...state.agentStatus, [run.agentId]: status } : state.agentStatus,
  })
  switch (ev.type) {
    case 'text': return set({ text: run.text ? `${run.text}\n\n${ev.text}` : ev.text })
    case 'tool': return set({ steps: [...run.steps, { name: ev.name, summary: ev.summary }] })
    case 'approval_request':
      return set({ approvals: [...run.approvals, { id: ev.id, toolName: ev.toolName, summary: ev.summary }] }, 'esperando')
    case 'approval_resolved':
      return set({ approvals: run.approvals.map(a => (a.id === ev.id ? { ...a, allowed: ev.allowed } : a)) }, 'trabalhando')
    case 'error': return set({ error: ev.message })
    case 'diff': return set({ files: ev.files })
    case 'run_finished':
      return set({ status: ev.status, finishedAt: Date.now() }, ev.status === 'done' ? 'concluido' : 'disponivel')
    default: return state
  }
}

export function withPrompt(state: ChatState, runId: string, prompt: string): ChatState {
  return { ...state, runs: state.runs.map(r => (r.runId === runId ? { ...r, prompt } : r)) }
}
