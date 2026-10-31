import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { RunEvent } from '@shared/events'
import { AntigravityAdapter } from './adapters/antigravity'
import { ClaudeAdapter } from './adapters/claude'
import { CodexAdapter } from './adapters/codex'
import { registerIpc } from './ipc'
import { RunService } from './runs/runService'
import { openStore } from './store/db'
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
  const runs = new RunService({
    store,
    adapters: { claude: new ClaudeAdapter(), codex: new CodexAdapter(), gemini: new AntigravityAdapter(), opencode: undefined },
    emit: (runId, ev) => send(runId, ev),
    toolReady: async t => { const s = (await tools())[t]; return s.installed && s.loggedIn },
  })
  await runs.recover()
  send = registerIpc(createWindow(), store, runs, tools)
})
app.on('window-all-closed', () => app.quit())
