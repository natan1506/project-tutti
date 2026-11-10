import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { toolPath } from './env'

// Qual `claude`/`codex` o Tutti usa. O app traz os binários embutidos nos SDKs (pacotes por arquitetura); o pacote só
// do terminal não traz (seriam ~650 MB) e usa os instalados na máquina — que a pessoa já precisa ter, logados.

const BUNDLED: Record<'claude' | 'codex', string> = {
  claude: `@anthropic-ai/claude-agent-sdk-darwin-${process.arch}`,
  codex: `@openai/codex-darwin-${process.arch}`,
}

function isExecutable(p: string): boolean {
  try { accessSync(p, constants.X_OK); return true } catch { return false }
}

/** `undefined` = o SDK usa o próprio binário (ou avisa que falta); senão, o caminho do instalado. */
export function pickExecutable(name: 'claude' | 'codex', o: { hasBundled: boolean; path: string }): string | undefined {
  if (o.hasBundled) return undefined
  for (const dir of o.path.split(':').filter(Boolean)) {
    const f = join(dir, name)
    if (isExecutable(f)) return f
  }
  return undefined
}

const cache = new Map<string, string | undefined>()
function hasBundled(pkg: string): boolean {
  try { createRequire(import.meta.url).resolve(`${pkg}/package.json`); return true } catch { return false }
}

export function executableFor(name: 'claude' | 'codex'): string | undefined {
  if (!cache.has(name)) cache.set(name, pickExecutable(name, { hasBundled: hasBundled(BUNDLED[name]), path: toolPath() }))
  return cache.get(name)
}
