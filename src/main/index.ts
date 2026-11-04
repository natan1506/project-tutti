import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { checkForUpdate } from './updates/updateCheck'
import { windowOptions } from './windowOptions'
import { KeyStore } from './keys/keyStore'
import { ProfileService } from './profiles/profileService'
import { SkillService } from './skills/skillService'
import { existsSync, mkdirSync } from 'node:fs'
import { DEFAULT_AUTONOMY, isAutonomyLevel } from '@shared/autonomy'
import { TextBrain } from './team/textBrain'
import { join } from 'node:path'
import { agentsOfProfile, getAgent, type ToolKind } from '@shared/agents'
import type { RunEvent } from '@shared/events'
import { isPaidApi, PADRAO, type Profile } from '@shared/profiles'
import { AntigravityAdapter } from './adapters/antigravity'
import { ClaudeAdapter, pollClaudeUsage } from './adapters/claude'
import { CodexAdapter } from './adapters/codex'
import { OpencodeAdapter, OpencodeHost, startOpencodeServer } from './adapters/opencode'
import { registerIpc } from './ipc'
import { VoiceService } from './voice/voiceService'
import { sayToWav, sayVoices } from './voice/say'
import { RunService } from './runs/runService'
import { openStore } from './store/db'
import { ClaudeBrain } from './team/brain'
import { TeamService } from './team/teamService'
import { cachedDetector, realExec } from './tools/detect'
import { pickReplacement } from './usage/handoff'
import { UsageService } from './usage/usageService'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow(windowOptions(join(import.meta.dirname, '../preload/index.cjs')))
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(async () => {
  // Empacotado, o ícone vem do bundle; em dev o Dock mostraria o do Electron.
  if (!app.isPackaged) app.dock?.setIcon(join(import.meta.dirname, '../../build/icon.png'))
  const store = openStore(join(app.getPath('userData'), 'time.db'))
  let send: (runId: string, ev: RunEvent) => void = () => {}
  let pushProfiles: (ps: Profile[]) => void = () => {}
  const profiles = new ProfileService({ store, emit: ps => pushProfiles(ps) })
  const keys = new KeyStore({ store, crypto: {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: s => safeStorage.encryptString(s),
    decrypt: b => safeStorage.decryptString(b),
  } })
  const tools = cachedDetector(realExec)
  // Spec custos-e-perfis §8: as chaves vão só para o processo do opencode.
  const opencode = new OpencodeHost(() => startOpencodeServer(undefined, keys.all()))
  let quitting = false
  app.on('before-quit', e => {
    if (quitting || !opencode.isRunning) return
    // Espera o servidor do opencode sair (até ~3 s) para não deixar processo órfão.
    e.preventDefault()
    quitting = true
    void opencode.close().finally(() => app.quit())
  })
  const adapters = { claude: new ClaudeAdapter(), codex: new CodexAdapter(), gemini: new AntigravityAdapter(), opencode: new OpencodeAdapter(opencode) }
  const toolReady = async (t: ToolKind) => { const s = (await tools())[t]; return s.installed && s.loggedIn }
  let pushUsage: (s: import('@shared/usage').UsageSnapshot) => void = () => {}
  let pushActivity: (n: number) => void = () => {}
  const usage = new UsageService({ store, emit: s => pushUsage(s), pollClaude: async () => ((await toolReady('claude')) ? pollClaudeUsage() : []) })
  const runs = new RunService({
    store,
    adapters,
    emit: (runId, ev) => send(runId, ev),
    toolReady,
    keyReady: p => keys.get(p) !== undefined,
    onUsage: (runId, agentId, ev) => usage.onEvent(runId, agentId, ev),
    skillsFor: id => skills.skillsFor(id),
    skillPluginDir: id => join(app.getPath('userData'), 'skill-plugins', id),
    autonomyFor: p => { const v = store.getSetting(`autonomy:${p}`); return isAutonomyLevel(v) ? v : DEFAULT_AUTONOMY },
    // O sandbox do Agent SDK no macOS usa o sandbox-exec do sistema (spike-sandbox).
    sandboxAvailable: () => process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec'),
    onActivity: n => pushActivity(n),
  })
  // Skills (plano skills): quem cria roda numa pasta vazia do app, em consulta.
  const skillWork = join(app.getPath('userData'), 'skill-work')
  mkdirSync(skillWork, { recursive: true })
  const skills = new SkillService({ store, runs, workDir: skillWork, isPaid: id => isPaidApi(getAgent(id)) })
  // Spec custos-e-perfis §5: ferramenta passou do limite → aviso nos runs dela, com substituto sugerido.
  usage.onCross((tool, _row, window, utilization) => {
    void runs.warnLimit(tool, window, utilization, async from => {
      const ready = await Promise.all(agentsOfProfile(getAgent(from).profileId).map(async a => ((await runs.availability(a.id)).ok ? a.id : null)))
      return pickReplacement(from, ready.filter((x): x is NonNullable<typeof x> => !!x), usage.snapshot(), t => usage.alertAt(t))
    })
  })
  const voices = new VoiceService({
    store, fetch: globalThis.fetch, sayVoices, sayToWav,
    crypto: { isAvailable: () => safeStorage.isEncryptionAvailable(), encrypt: s => safeStorage.encryptString(s), decrypt: b => safeStorage.decryptString(b) },
    profileAgents: id => agentsOfProfile(getAgent(id).profileId).map(a => a.id),
  })
  void voices.macVoices().catch(() => {})
  const claudeBrain = new ClaudeBrain()
  const team = new TeamService({
    runs, store, brain: claudeBrain, adapters, toolReady, emit: (runId, ev) => send(runId, ev),
    profileOf: id => (id && profiles.get(id)) || PADRAO,
    // Coordenador Claude por CLI usa a saída estruturada; qualquer outro responde JSON em texto.
    brainFor: c => (c.transport.kind === 'cli' && c.tool === 'claude' ? claudeBrain : new TextBrain(adapters[c.tool], c)),
  })
  await runs.recover()
  const win = createWindow()
  pushUsage = s => { if (!win.isDestroyed()) win.webContents.send('usage', s) }
  pushActivity = n => { if (!win.isDestroyed()) win.webContents.send('activity', n) }
  pushProfiles = ps => { if (!win.isDestroyed()) win.webContents.send('profiles', ps) }
  send = registerIpc(win, store, runs, team, usage, tools, { profiles, keys, keysChanged: () => void opencode.restart(), runs, models: async p => (await opencode.api()).models?.(p) ?? [], skills, voices })
  // Versão nova no GitHub (só no app empacotado): aviso com link para a release; a URL nunca vem da interface.
  let update: { version: string; url: string } | null = null
  ipcMain.handle('updateInfo', () => update)
  ipcMain.handle('openUpdate', () => (update ? shell.openExternal(update.url) : undefined))
  const checkUpdate = async () => {
    const u = await checkForUpdate(app.getVersion())
    if (u && u.version !== update?.version) { update = u; if (!win.isDestroyed()) win.webContents.send('update', u) }
  }
  if (app.isPackaged) {
    setTimeout(() => void checkUpdate(), 15_000)
    setInterval(() => void checkUpdate(), 6 * 60 * 60_000)
  }
  const stopPolling = usage.startPolling()
  app.on('will-quit', stopPolling)
})
app.on('window-all-closed', () => app.quit())
