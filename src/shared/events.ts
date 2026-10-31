import type { AgentId } from './agents'

export type RunStatus = 'running' | 'done' | 'error' | 'cancelled' | 'interrupted'

export interface DiffFile {
  path: string
  added: number
  removed: number
  status: 'A' | 'M' | 'D'
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'file_changed'; path: string }
  | { type: 'approval_request'; id: string; toolName: string; summary: string }
  | { type: 'approval_resolved'; id: string; allowed: boolean }
  | { type: 'question'; id: string; text: string; options?: string[] }
  | { type: 'question_answered'; id: string; answer: string | null }
  | { type: 'done'; sessionId?: string }
  | { type: 'error'; message: string }

export type RunEvent =
  | AgentEvent
  | { type: 'run_started'; runId: string; agentId: AgentId }
  | { type: 'diff'; files: DiffFile[] }
  | { type: 'notice'; text: string }
  | { type: 'run_finished'; status: RunStatus }
