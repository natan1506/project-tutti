import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { ToolKind } from '@shared/agents'
import type { RunEvent } from '@shared/events'
import { AntigravityAdapter } from './adapters/antigravity'
import { ClaudeAdapter } from './adapters/claude'
import { CodexAdapter } from './adapters/codex'
import { OpencodeAdapter, OpencodeHost, startOpencodeServer } from './adapters/opencode'
import { registerIpc } from './ipc'
import { RunService } from './runs/runService'
import { openStore } from './store/db'
import { ClaudeBrain } from './team/brain'
import { TeamService } from './team/teamService'
import { cachedDetector, realExec } from './tools/detect'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1200, minHeight: 640, backgroundColor: '#0c0b1f', title: 'Tutti',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(async () => {
  app.dock?.setIcon(join(import.meta.dirname, '../../build/icon.png'))
  const store = openStore(join(app.getPath('userData'), 'time.db'))
  let send: (runId: string, ev: RunEvent) => void = () => {}
  const tools = cachedDetector(realExec)
  const opencode = new OpencodeHost(() => startOpencodeServer())
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
  const runs = new RunService({
    store,
    adapters,
    emit: (runId, ev) => send(runId, ev),
    toolReady,
  })
  const team = new TeamService({ runs, store, brain: new ClaudeBrain(), adapters, toolReady, emit: (runId, ev) => send(runId, ev) })
  await runs.recover()
  send = registerIpc(createWindow(), store, runs, team, tools)
})
app.on('window-all-closed', () => app.quit())
