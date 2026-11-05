// Limpa as cópias do Tutti que o macOS lista além da instalada em /Applications:
// - os apps que todo build do electron-builder deixa em release/mac*/ (o Spotlight indexa e registra);
// - os instaladores .dmg que ficaram montados em /Volumes depois de arrastar o app;
// - o Tutti antigo na Lixeira (só tira do registro: nada é apagado lá).
// As dependências entram por parâmetro para dar para testar sem mexer no Mac de verdade.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
export const TARGET = '/Applications/Tutti.app'
const BUILD_DIRS = ['mac', 'mac-arm64', 'mac-universal']

const quiet = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }) } catch { /* não é fatal */ } }
const safeList = p => { try { return readdirSync(p) } catch { return [] } }

export function cleanStrayApps({
  root = process.cwd(),
  home = homedir(),
  exists = existsSync,
  list = safeList,
  run = quiet,
  rm = p => rmSync(p, { recursive: true, force: true }),
  log = msg => console.log(msg),
} = {}) {
  for (const d of BUILD_DIRS) {
    const dir = join(root, 'release', d)
    const app = join(dir, 'Tutti.app')
    if (exists(app)) run(LSREGISTER, ['-u', app])
    rm(dir)
  }

  for (const name of list('/Volumes').filter(n => /^Tutti( |$)/.test(n))) {
    const vol = `/Volumes/${name}`
    run(LSREGISTER, ['-u', `${vol}/Tutti.app`])
    run('hdiutil', ['detach', vol])
    log(`Instalador ejetado: ${vol}`)
  }

  const trash = join(home, '.Trash')
  for (const name of list(trash).filter(n => /^Tutti.*\.app$/.test(n))) run(LSREGISTER, ['-u', join(trash, name)])

  if (exists(TARGET)) run(LSREGISTER, ['-f', TARGET])
}
