import type { AgentId, ToolKind } from './agents'
import type { Confirmation, Lineup, TriageScore } from './team'
import type { LimitWindow, TokenUsage, UsageSource, WindowKind } from './usage'

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
  | { type: 'usage'; tool: UsageSource; tokens: TokenUsage }
  | { type: 'limit'; limit: LimitWindow }

export type RunEvent =
  | AgentEvent
  | { type: 'run_started'; runId: string; agentId: AgentId }
  | { type: 'diff'; files: DiffFile[] }
  | { type: 'notice'; text: string }
  | { type: 'team_started' }
  | { type: 'triage'; scores: TriageScore[]; candidates: AgentId[] }
  | { type: 'confirmation'; confirmation: Confirmation }
  | { type: 'lineup'; lineup: Lineup; waves: number[][]; big: boolean }
  | { type: 'plan_request'; id: string }
  | { type: 'plan_resolved'; id: string; approved: boolean }
  | { type: 'child_started'; runId: string; agentId: AgentId; task: string }
  | { type: 'queued'; position: number }
  | { type: 'agent_call'; from: AgentId; to: AgentId; question: string }
  | { type: 'agent_call_answer'; from: AgentId; to: AgentId; answer: string }
  | { type: 'limit_warning'; id: string; tool: ToolKind; window: WindowKind; utilization: number; to?: AgentId }
  | { type: 'limit_resolved'; id: string; pass: boolean }
  | { type: 'handoff'; to: AgentId; newRunId: string }
  | { type: 'run_finished'; status: RunStatus }
