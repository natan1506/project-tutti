// Instala o Tutti em /Applications substituindo a versão anterior, sem deixar cópias soltas.
// Gera só a pasta do app (sem .dmg) na arquitetura do Node atual — os binários dos SDKs em node_modules
// são dessa arquitetura. Depois apaga as cópias de build em release/ e tira do registro do macOS,
// para o Spotlight/Launchpad mostrarem um Tutti só.
// Uso: npm run install-app
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })
const quiet = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }) } catch { /* não é fatal */ } }
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const TARGET = '/Applications/Tutti.app'
const BUILD_DIRS = ['mac', 'mac-arm64', 'mac-universal'].map(d => join(process.cwd(), 'release', d))
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'

run('npx', ['electron-vite', 'build'])
run('npx', ['electron-builder', '--mac', 'dir', `--${arch}`])

const built = BUILD_DIRS.map(d => join(d, 'Tutti.app')).find(existsSync)
if (!built) throw new Error('build não gerou Tutti.app em release/')

// Fecha o Tutti aberto antes de trocar o app.
quiet('osascript', ['-e', 'if application id "dev.natan.tutti" is running then tell application id "dev.natan.tutti" to quit'])
rmSync(TARGET, { recursive: true, force: true })
run('ditto', [built, TARGET])

for (const d of BUILD_DIRS) {
  const app = join(d, 'Tutti.app')
  if (existsSync(app)) quiet(LSREGISTER, ['-u', app])
  rmSync(d, { recursive: true, force: true })
}
quiet(LSREGISTER, ['-f', TARGET])
console.log(`Tutti instalado em ${TARGET} (${arch}).`)
