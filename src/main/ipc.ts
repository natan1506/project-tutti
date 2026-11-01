import { BrowserWindow, dialog, ipcMain } from 'electron'
import { isAbsolute } from 'node:path'
import { AGENTS, type AgentId, type ToolKind } from '@shared/agents'
import type { RunEvent } from '@shared/events'
import type { StartRunInput, ToolStatus } from '@shared/models'
import { initRepo, isGitRepo } from './git/git'
import type { RunService } from './runs/runService'
import type { TeamService } from './team/teamService'
import type { UsageService } from './usage/usageService'
import type { UsageSettings } from '@shared/usage'
import type { Store } from './store/db'

const absolutePath = (p: unknown): string => {
  if (typeof p !== 'string' || !isAbsolute(p)) throw new Error('Caminho inválido')
  return p
}
const text = (s: unknown): string => {
  if (typeof s !== 'string') throw new Error('Texto inválido')
  return s
}
const agentId = (id: unknown): AgentId => {
  if (!AGENTS.some(a => a.id === id)) throw new Error('Agente inválido')
  return id as AgentId
}
/** Só números de 1 a 100 (porcentagem) e tetos positivos; o resto é ignorado. */
function sanitizeUsageSettings(raw: unknown): Partial<UsageSettings> {
  const r = (raw ?? {}) as Record<string, unknown>
  const pct = (v: unknown) => (typeof v === 'number' && v >= 1 && v <= 100 ? Math.round(v) : undefined)
  const out: Partial<UsageSettings> = {}
  if (pct(r.alertAt) !== undefined) out.alertAt = pct(r.alertAt)
  if (r.perTool && typeof r.perTool === 'object') {
    out.perTool = {}
    for (const t of ['claude', 'codex', 'gemini', 'opencode'] as const) {
      const v = (r.perTool as Record<string, Record<string, unknown> | undefined>)[t]
      if (!v) continue
      const ceiling = typeof v.estimateCeilingTokens === 'number' && v.estimateCeilingTokens > 0 ? Math.round(v.estimateCeilingTokens) : undefined
      out.perTool[t] = { ...(pct(v.alertAt) !== undefined ? { alertAt: pct(v.alertAt) } : {}), ...(ceiling ? { estimateCeilingTokens: ceiling } : {}) }
    }
  }
  return out
}
const paths = (p: unknown): string[] | undefined => (Array.isArray(p) ? p.map(text) : undefined)

export function registerIpc(win: BrowserWindow, store: Store, runs: RunService, team: TeamService, usage: UsageService, tools: () => Promise<Record<ToolKind, ToolStatus>>): (runId: string, ev: RunEvent) => void {
  ipcMain.handle('usageSnapshot', () => usage.snapshot())
  ipcMain.handle('usageDetail', (_e, conversationId) => ({
    byRun: typeof conversationId === 'string' ? store.tokensByRun(conversationId) : [],
    byDay: store.tokensByDay(7),
  }))
  ipcMain.handle('usageSettings', () => usage.settings())
  ipcMain.handle('updateUsageSettings', (_e, s) => usage.updateSettings(sanitizeUsageSettings(s)))
  ipcMain.handle('toolStatus', () => tools())
  ipcMain.handle('pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('openProject', async (_e, p) => {
    const path = absolutePath(p)
    return { project: store.upsertProject(path), isGitRepo: await isGitRepo(path) }
  })
  ipcMain.handle('initGit', (_e, p) => initRepo(absolutePath(p)))
  ipcMain.handle('recentProjects', () => store.recentProjects())
  ipcMain.handle('newConversation', (_e, projectId, title) => store.createConversation(text(projectId), text(title)))
  ipcMain.handle('listConversations', (_e, projectId) => store.listConversations(text(projectId)))
  ipcMain.handle('loadConversation', (_e, id) => {
    const list = store.listRuns(text(id))
    return { runs: list, events: Object.fromEntries(list.map(r => [r.id, store.listEvents(r.id)])) }
  })
  ipcMain.handle('startRun', (_e, input: StartRunInput) =>
    runs.start({ projectPath: absolutePath(input?.projectPath), conversationId: text(input?.conversationId), agentId: agentId(input?.agentId), prompt: text(input?.prompt) }))
  ipcMain.handle('startTeam', (_e, input) => team.start({
    projectPath: absolutePath(input?.projectPath), conversationId: text(input?.conversationId), prompt: text(input?.prompt),
    fullRound: input?.fullRound === true, forcePlan: input?.forcePlan === true,
  }))
  ipcMain.handle('respondPlan', (_e, id, approved) => team.respondPlan(text(id), approved === true))
  ipcMain.handle('respondApproval', (_e, id, allowed) => runs.respondApproval(text(id), allowed === true))
  ipcMain.handle('answerQuestion', (_e, id, answer) => runs.answerQuestion(text(id), text(answer)))
  ipcMain.handle('cancelRun', (_e, runId) => runs.cancel(text(runId)))
  ipcMain.handle('undo', (_e, runId, p) => runs.undo(text(runId), paths(p)))
  ipcMain.handle('patch', (_e, runId, p) => runs.patch(text(runId), p === undefined ? undefined : text(p)))

  return (runId, ev) => { if (!win.isDestroyed()) win.webContents.send('runEvent', runId, ev) }
}
