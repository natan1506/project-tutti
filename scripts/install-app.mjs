// Instala o Tutti em /Applications substituindo a versão anterior, sem deixar cópias soltas.
// Gera só a pasta do app (sem .dmg) na arquitetura do Node atual — os binários dos SDKs em node_modules
// são dessa arquitetura. Depois apaga as cópias de build em release/ e tira do registro do macOS,
// ejeta .dmg do Tutti montados e tira a Lixeira do registro, para o Spotlight/Launchpad mostrarem um Tutti só.
// Uso: npm run install-app
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { cleanStrayApps, TARGET } from './lib/stray-apps.mjs'

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })
const quiet = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }) } catch { /* não é fatal */ } }
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

cleanStrayApps()
console.log(`Tutti instalado em ${TARGET} (${arch}).`)
