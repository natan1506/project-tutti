// No macOS, o nome no Dock e no menu em modo dev vem do Info.plist do Electron.app de node_modules,
// não do productName. Troca "Electron" por "Tutti" ali; roda antes do dev e depois de cada npm install.
import { execFileSync } from 'node:child_process'
import { existsSync, utimesSync } from 'node:fs'
import { join } from 'node:path'

if (process.platform === 'darwin') {
  const app = join(import.meta.dirname, '../node_modules/electron/dist/Electron.app')
  const plist = join(app, 'Contents/Info.plist')
  if (existsSync(plist)) {
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} Tutti`, plist])
    }
    // Faz o Dock reler o bundle em vez de usar o nome em cache.
    const now = new Date()
    utimesSync(app, now, now)
  }
}
