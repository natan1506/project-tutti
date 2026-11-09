import { BrowserWindow, dialog, ipcMain } from 'electron'
import { isAbsolute } from 'node:path'
import { knownAgent, type AgentId, type ToolKind } from '@shared/agents'
import type { RunEvent } from '@shared/events'
import type { StartRunInput, ToolStatus } from '@shared/models'
import type { RunService } from './runs/runService'
import type { TeamService } from './team/teamService'
import type { UsageService } from './usage/usageService'
import type { UsageSettingsPatch } from '@shared/usage'
import type { Store } from './store/db'
import type { KeyStore } from './keys/keyStore'
import type { ProfileService } from './profiles/profileService'
import { PROVIDERS, type ProviderId } from '@shared/profiles'
import { DEFAULT_AUTONOMY, isAutonomyLevel } from '@shared/autonomy'
import type { SkillService } from './skills/skillService'
import { skillHandlers } from './skills/skillIpc'
import { voiceHandlers } from './voice/voiceIpc'
import { lookHandlers } from './lookIpc'
import { browserHandlers } from './browser/browserIpc'
import type { BrowserService } from './browser/browserService'
import type { VoiceService } from './voice/voiceService'

const absolutePath = (p: unknown): string => {
  if (typeof p !== 'string' || !isAbsolute(p)) throw new Error('Caminho inválido')
  return p
}
const text = (s: unknown): string => {
  if (typeof s !== 'string') throw new Error('Texto inválido')
  return s
}
const agentId = (id: unknown): AgentId => {
  if (typeof id !== 'string' || !knownAgent(id)) throw new Error('Agente inválido')
  return id as AgentId
}
/** Só números de 1 a 100 (porcentagem) e tetos positivos; o resto é ignorado. */
function sanitizeUsageSettings(raw: unknown): UsageSettingsPatch {
  const r = (raw ?? {}) as Record<string, unknown>
  const pct = (v: unknown) => (typeof v === 'number' && v >= 1 && v <= 100 ? Math.round(v) : undefined)
  const out: UsageSettingsPatch = {}
  if (pct(r.alertAt) !== undefined) out.alertAt = pct(r.alertAt)
  if (r.perTool && typeof r.perTool === 'object') {
    out.perTool = {}
    for (const t of ['claude', 'codex', 'gemini', 'opencode'] as const) {
      const v = (r.perTool as Record<string, Record<string, unknown> | undefined>)[t]
      if (!v) continue
      const ceiling = typeof v.estimateCeilingTokens === 'number' && v.estimateCeilingTokens > 0 ? Math.round(v.estimateCeilingTokens) : undefined
      out.perTool[t] = {
        ...(v.alertAt === null ? { alertAt: null } : pct(v.alertAt) !== undefined ? { alertAt: pct(v.alertAt) } : {}),
        ...(v.estimateCeilingTokens === null ? { estimateCeilingTokens: null } : ceiling ? { estimateCeilingTokens: ceiling } : {}),
      }
    }
  }
  return out
}
const paths = (p: unknown): string[] | undefined => (Array.isArray(p) ? p.map(text) : undefined)

export interface ProfileDeps {
  profiles: ProfileService
  keys: KeyStore
  keysChanged(): void
  runs: RunService
  models(provider: ProviderId): Promise<{ id: string; name: string }[]>
  skills: SkillService
  voices: VoiceService
  browser: BrowserService
}

const provider = (p: unknown): ProviderId => {
  if (!PROVIDERS.some(x => x.id === p)) throw new Error('provedor desconhecido')
  return p as ProviderId
}

export function registerIpc(win: BrowserWindow, store: Store, runs: RunService, team: TeamService, usage: UsageService, tools: () => Promise<Record<ToolKind, ToolStatus>>, pd: ProfileDeps): (runId: string, ev: RunEvent) => void {
  ipcMain.handle('profiles', () => pd.profiles.all())
  ipcMain.handle('removedAgents', () => pd.profiles.removedAgents())
  ipcMain.handle('saveProfile', (_e, p) => pd.profiles.save(p))
  ipcMain.handle('deleteProfile', (_e, id) => pd.profiles.remove(text(id)))
  ipcMain.handle('duplicateProfile', (_e, id, nome) => pd.profiles.duplicate(text(id), typeof nome === 'string' ? nome : undefined))
  ipcMain.handle('activeProfile', (_e, projectId) => pd.profiles.activeFor(text(projectId)))
  ipcMain.handle('setActiveProfile', (_e, projectId, profileId) => pd.profiles.setActive(text(projectId), text(profileId)))
  // Nenhum handler devolve uma chave: a interface só sabe quais provedores têm.
  ipcMain.handle('providerKeys', () => pd.keys.which())
  ipcMain.handle('setProviderKey', (_e, p, key) => {
    if (typeof key !== 'string' || !key.trim() || key.length > 500) throw new Error('chave inválida')
    pd.keys.set(provider(p), key.trim())
    pd.keysChanged()
  })
  ipcMain.handle('removeProviderKey', (_e, p) => { pd.keys.remove(provider(p)); pd.keysChanged() })
  ipcMain.handle('providerModels', (_e, p) => pd.models(provider(p)).catch(() => []))
  // Disponibilidade de cada agente do perfil ativo do projeto (CLI pronta, chave salva…).
  ipcMain.handle('agentStatus', async (_e, projectId) => {
    const p = pd.profiles.activeFor(text(projectId))
    return Object.fromEntries(await Promise.all(p.agents.map(async a => [a.id, await pd.runs.availability(a.id)])))
  })
  const skills = skillHandlers(pd.skills)
  for (const [name, fn] of Object.entries(skills)) ipcMain.handle(name, (_e, arg) => (fn as (a: unknown) => unknown)(arg))
  // Parar tudo (design §5): todos os pedidos, de todos os projetos, e as execuções de skill.
  for (const [name, fn] of Object.entries(voiceHandlers(pd.voices))) ipcMain.handle(name, (_e, arg) => (fn as (a: unknown) => unknown)(arg))
  for (const [name, fn] of Object.entries(lookHandlers(store))) ipcMain.handle(name, (_e, arg) => (fn as (a: unknown) => unknown)(arg))
  for (const [name, fn] of Object.entries(browserHandlers(pd.browser))) ipcMain.handle(name, (_e, arg) => (fn as (a: unknown) => unknown)(arg))
  ipcMain.handle('stopAll', () => { runs.cancelAll(); skills.cancelAllSkills() })
  ipcMain.handle('activity', () => runs.activeCount())
  // Autonomia por projeto (design §4.2): chave pelo caminho, que é o que o RunService conhece.
  ipcMain.handle('autonomy', (_e, p) => { const v = store.getSetting(`autonomy:${absolutePath(p)}`); return isAutonomyLevel(v) ? v : DEFAULT_AUTONOMY })
  ipcMain.handle('setAutonomy', (_e, p, level) => {
    if (!isAutonomyLevel(level)) throw new Error('nível inválido')
    store.setSetting(`autonomy:${absolutePath(p)}`, level)
  })
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
    return { project: store.upsertProject(path) }
  })
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
    // O perfil do pedido de time é o ativo no projeto.
    profileId: pd.profiles.activeFor(store.upsertProject(absolutePath(input?.projectPath)).id).id,
  }))
  ipcMain.handle('respondLimit', (_e, id, pass) => runs.respondLimit(text(id), pass === true))
  ipcMain.handle('respondPlan', (_e, id, approved) => team.respondPlan(text(id), approved === true))
  ipcMain.handle('respondApproval', (_e, id, allowed) => runs.respondApproval(text(id), allowed === true))
  ipcMain.handle('answerQuestion', (_e, id, answer) => runs.answerQuestion(text(id), text(answer)))
  ipcMain.handle('cancelRun', (_e, runId) => runs.cancel(text(runId)))
  ipcMain.handle('undo', (_e, runId, p) => runs.undo(text(runId), paths(p)))
  ipcMain.handle('patch', (_e, runId, p) => runs.patch(text(runId), p === undefined ? undefined : text(p)))

  return (runId, ev) => { if (!win.isDestroyed()) win.webContents.send('runEvent', runId, ev) }
}
