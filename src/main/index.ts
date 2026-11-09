import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import type { RunEvent } from '@shared/events'
import type { Profile } from '@shared/profiles'
import { agentsOfProfile, getAgent } from '@shared/agents'
import { checkForUpdate } from './updates/updateCheck'
import { windowOptions } from './windowOptions'
import { createCore } from './core'
import { registerIpc } from './ipc'
import { VoiceService } from './voice/voiceService'
import { sayToWav, sayVoices } from './voice/say'
import { BrowserService } from './browser/browserService'
import { ElectronPage } from './browser/electronPage'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow(windowOptions(join(import.meta.dirname, '../preload/index.cjs')))
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(async () => {
  // Empacotado, o ícone vem do bundle; em dev o Dock mostraria o do Electron.
  if (!app.isPackaged) app.dock?.setIcon(join(import.meta.dirname, '../../build/icon.png'))
  let send: (runId: string, ev: RunEvent) => void = () => {}
  let pushProfiles: (ps: Profile[]) => void = () => {}
  let pushUsage: (s: import('@shared/usage').UsageSnapshot) => void = () => {}
  let pushActivity: (n: number) => void = () => {}
  const crypto = { isAvailable: () => safeStorage.isEncryptionAvailable(), encrypt: (s: string) => safeStorage.encryptString(s), decrypt: (b: Buffer) => safeStorage.decryptString(b) }
  // A janela nasce depois dos serviços; a página só é criada quando um agente pede, e aí ela já existe.
  let mainWindow: BrowserWindow | undefined
  const browser = new BrowserService({
    createPage: hooks => new ElectronPage(mainWindow!, hooks),
    emit: s => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('browser', s) },
  })
  const sweepBrowser = setInterval(() => browser.sweep(), 60_000)
  app.on('will-quit', () => clearInterval(sweepBrowser))
  if (process.env.TUTTI_E2E) (globalThis as { __tuttiBrowser?: BrowserService }).__tuttiBrowser = browser
  const core = await createCore({
    dataDir: app.getPath('userData'), crypto, browser,
    emit: (runId, ev) => send(runId, ev), onUsage: s => pushUsage(s), onProfiles: ps => pushProfiles(ps), onActivity: n => pushActivity(n),
  })
  const { store, profiles, keys, runs, team, usage, skills, tools, opencode } = core
  let quitting = false
  app.on('before-quit', e => {
    if (quitting || !opencode.isRunning) return
    // Espera o servidor do opencode sair (até ~3 s) para não deixar processo órfão.
    e.preventDefault()
    quitting = true
    void opencode.close().finally(() => app.quit())
  })
  const voices = new VoiceService({
    store, fetch: globalThis.fetch, sayVoices, sayToWav,
    crypto,
    profileAgents: id => agentsOfProfile(getAgent(id).profileId).map(a => a.id),
  })
  void voices.macVoices().catch(() => {})
  const win = createWindow()
  mainWindow = win
  pushUsage = s => { if (!win.isDestroyed()) win.webContents.send('usage', s) }
  pushActivity = n => { if (!win.isDestroyed()) win.webContents.send('activity', n) }
  pushProfiles = ps => { if (!win.isDestroyed()) win.webContents.send('profiles', ps) }
  send = registerIpc(win, store, runs, team, usage, tools, { profiles, keys, keysChanged: () => void opencode.restart(), runs, models: async p => (await opencode.api()).models?.(p) ?? [], skills, voices, browser })
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
