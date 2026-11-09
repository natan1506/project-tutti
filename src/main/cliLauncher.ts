import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Comando `tutti` (spec tutti-terminal §6): um script em ~/.local/bin que roda o núcleo com o Node do próprio app
// (ELECTRON_RUN_AS_NODE). Assim não depende de outro Node e usa a mesma versão do app instalado.

const q = (s: string) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`

export function launcherScript(exePath: string, entryPath: string): string {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${q(exePath)} ${q(entryPath)} "$@"\n`
}

export function installLauncher(o: { exePath: string; entryPath: string; binDir: string }): 'installed' | 'updated' | 'unchanged' {
  const file = join(o.binDir, 'tutti')
  const script = launcherScript(o.exePath, o.entryPath)
  const existed = existsSync(file)
  if (existed && readFileSync(file, 'utf8') === script) return 'unchanged'
  mkdirSync(o.binDir, { recursive: true })
  writeFileSync(file, script)
  chmodSync(file, 0o755)
  return existed ? 'updated' : 'installed'
}
