import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ToolKind } from '@shared/agents'
import type { ToolStatus } from '@shared/models'
import { safeEnv } from '../adapters/env'

// Quais CLIs estão instalados e logados; agente sem ferramenta pronta fica travado no palco.

export type Exec = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>

const SPEC: Record<ToolKind, { cmd: string; nome: string; credential?: (home: string) => string }> = {
  claude: { cmd: 'claude', nome: 'Claude Code' },
  codex: { cmd: 'codex', nome: 'Codex' },
  gemini: { cmd: 'agy', nome: 'Antigravity', credential: h => join(h, '.gemini/antigravity-cli/antigravity-oauth-token') },
  // opencode funciona com os modelos gratuitos `opencode/*` sem login em provedor.
  opencode: { cmd: 'opencode', nome: 'opencode' },
}

async function probe(tool: ToolKind, exec: Exec, home: string): Promise<ToolStatus> {
  const { cmd, nome, credential } = SPEC[tool]
  let out: Awaited<ReturnType<Exec>> | undefined
  try {
    out = await exec(cmd, ['--version'])
  } catch {
    out = undefined
  }
  if (!out || out.code !== 0) return { tool, installed: false, loggedIn: false, hint: `Instale o ${nome}` }
  const version = out.stdout.match(/\d+\.\d+\.\d+/)?.[0]
  const loggedIn = credential ? existsSync(credential(home)) : true
  return { tool, installed: true, loggedIn, version, ...(loggedIn ? {} : { hint: `Entre no ${nome}` }) }
}

export async function detectTools(exec: Exec, home = homedir()): Promise<Record<ToolKind, ToolStatus>> {
  const kinds = Object.keys(SPEC) as ToolKind[]
  const all = await Promise.all(kinds.map(k => probe(k, exec, home)))
  return Object.fromEntries(all.map(s => [s.tool, s])) as Record<ToolKind, ToolStatus>
}

/** Detecta de novo no máximo a cada `ttlMs`; rodar quatro `--version` a cada pedido seria lento. */
export function cachedDetector(exec: Exec, ttlMs = 2 * 60_000, now = Date.now, home = homedir()): () => Promise<Record<ToolKind, ToolStatus>> {
  let cache: { at: number; value: Promise<Record<ToolKind, ToolStatus>> } | undefined
  return () => {
    if (!cache || now() - cache.at > ttlMs) cache = { at: now(), value: detectTools(exec, home) }
    return cache.value
  }
}

/** `Exec` real: roda o CLI com o PATH ampliado; 15 s cobre a primeira execução fria de um CLI. */
export const realExec: Exec = (cmd, args) => new Promise(resolve => {
  execFile(cmd, args, { env: safeEnv(), timeout: 15_000 }, (err, stdout, stderr) => {
    const code = err ? (typeof err.code === 'number' ? err.code : 127) : 0
    resolve({ code, stdout: String(stdout), stderr: String(stderr) })
  })
})
