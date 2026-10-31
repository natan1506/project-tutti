import type { AgentId, ToolKind } from './agents'
import type { RunEvent, RunStatus } from './events'

export interface Project { id: string; path: string; name: string; lastOpenedAt: number }
export interface Conversation { id: string; projectId: string; title: string; createdAt: number }
export interface RunRow {
  id: string; conversationId: string; agentId: AgentId; prompt: string; status: RunStatus
  sessionId: string | null; startedAt: number; finishedAt: number | null; hasCheckpoint: boolean
}
export interface ToolStatus { tool: ToolKind; installed: boolean; loggedIn: boolean; version?: string; hint?: string }
export type UndoResult = { ok: true } | { ok: false; conflicts: string[] }
export interface StartRunInput { projectPath: string; conversationId: string; agentId: AgentId; prompt: string }

/** API exposta ao renderer pelo preload como `window.time`. */
export interface TimeApi {
  pickFolder(): Promise<string | null>
  openProject(path: string): Promise<{ project: Project; isGitRepo: boolean }>
  initGit(path: string): Promise<void>
  recentProjects(): Promise<Project[]>
  newConversation(projectId: string, title: string): Promise<Conversation>
  listConversations(projectId: string): Promise<Conversation[]>
  loadConversation(id: string): Promise<{ runs: RunRow[]; events: Record<string, RunEvent[]> }>
  startRun(input: StartRunInput): Promise<string>
  respondApproval(id: string, allowed: boolean): Promise<void>
  answerQuestion(id: string, answer: string): Promise<void>
  cancelRun(runId: string): Promise<void>
  undo(runId: string, paths?: string[]): Promise<UndoResult>
  patch(runId: string, path?: string): Promise<string>
  toolStatus(): Promise<Record<ToolKind, ToolStatus>>
  onRunEvent(cb: (runId: string, ev: RunEvent) => void): () => void
}
