import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { RunEvent } from '@shared/events'
import { ClaudeAdapter } from './adapters/claude'
import { CodexAdapter } from './adapters/codex'
import { registerIpc } from './ipc'
import { RunService } from './runs/runService'
import { openStore } from './store/db'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#0f0d0c', title: 'Time',
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
  const store = openStore(join(app.getPath('userData'), 'time.db'))
  let send: (runId: string, ev: RunEvent) => void = () => {}
  const runs = new RunService({
    store,
    adapters: { claude: new ClaudeAdapter(), codex: new CodexAdapter(), gemini: undefined, opencode: undefined },
    emit: (runId, ev) => send(runId, ev),
  })
  await runs.recover()
  send = registerIpc(createWindow(), store, runs)
})
app.on('window-all-closed', () => app.quit())
