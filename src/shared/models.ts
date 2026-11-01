import type { AgentDef, AgentId, ToolKind } from './agents'
import type { Profile, ProviderId } from './profiles'
import type { UsageDetail, UsageSettings, UsageSettingsPatch, UsageSnapshot } from './usage'
import type { RunEvent, RunStatus } from './events'

export interface Project { id: string; path: string; name: string; lastOpenedAt: number }
export interface Conversation { id: string; projectId: string; title: string; createdAt: number }
export interface RunRow {
  id: string; conversationId: string; agentId: AgentId; prompt: string; status: RunStatus
  sessionId: string | null; startedAt: number; finishedAt: number | null; hasCheckpoint: boolean
  parentRunId: string | null
}
export interface ToolStatus { tool: ToolKind; installed: boolean; loggedIn: boolean; version?: string; hint?: string }
export type UndoResult = { ok: true } | { ok: false; conflicts: string[] }
export interface StartRunInput {
  projectPath: string; conversationId: string; agentId: AgentId; prompt: string
  /** Só runs-filhos de um pedido de time. */
  parentRunId?: string; model?: string; mode?: 'work' | 'consult'
}

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
  startTeam(input: { projectPath: string; conversationId: string; prompt: string; fullRound?: boolean; forcePlan?: boolean }): Promise<string>
  respondPlan(id: string, approved: boolean): Promise<void>
  respondLimit(id: string, pass: boolean): Promise<void>
  respondApproval(id: string, allowed: boolean): Promise<void>
  answerQuestion(id: string, answer: string): Promise<void>
  cancelRun(runId: string): Promise<void>
  undo(runId: string, paths?: string[]): Promise<UndoResult>
  patch(runId: string, path?: string): Promise<string>
  toolStatus(): Promise<Record<ToolKind, ToolStatus>>
  usageSnapshot(): Promise<UsageSnapshot>
  usageDetail(conversationId: string | null): Promise<UsageDetail>
  profiles(): Promise<Profile[]>
  removedAgents(): Promise<AgentDef[]>
  saveProfile(p: Profile): Promise<{ ok: true; profile: Profile } | { ok: false; errors: string[] }>
  deleteProfile(id: string): Promise<void>
  duplicateProfile(id: string, nome?: string): Promise<Profile>
  activeProfile(projectId: string): Promise<Profile>
  setActiveProfile(projectId: string, profileId: string): Promise<void>
  onProfiles(cb: (profiles: Profile[]) => void): () => void
  providerKeys(): Promise<Record<ProviderId, boolean>>
  providerModels(provider: ProviderId): Promise<{ id: string; name: string }[]>
  agentStatus(projectId: string): Promise<Record<AgentId, { ok: boolean; hint?: string }>>
  setProviderKey(provider: ProviderId, key: string): Promise<void>
  removeProviderKey(provider: ProviderId): Promise<void>
  usageSettings(): Promise<UsageSettings>
  updateUsageSettings(s: UsageSettingsPatch): Promise<void>
  onUsage(cb: (s: UsageSnapshot) => void): () => void
  onRunEvent(cb: (runId: string, ev: RunEvent) => void): () => void
}
