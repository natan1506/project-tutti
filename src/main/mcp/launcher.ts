import { randomUUID } from 'node:crypto'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServerDef } from '@shared/mcp'

// Segredo de MCP fora da linha de comando (spec mcps §6): o SDK do Claude passa a config em --mcp-config e o do Codex
// em --config, e os dois aparecem no `ps`. Com segredo, o MCP sobe por este lançador, que lê comando e env de um
// arquivo 0600 e executa o MCP de verdade. O arquivo some no fim do pedido (cleanup): a ferramenta pode subir o MCP
// mais de uma vez no mesmo pedido.

export const LAUNCHER_JS = `'use strict'
const { readFileSync } = require('node:fs')
const { spawn } = require('node:child_process')
const file = process.argv[2]
const spec = JSON.parse(readFileSync(file, 'utf8'))
const env = { ...process.env, ...spec.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(spec.command, spec.args, { stdio: 'inherit', env })
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => child.kill(s))
child.on('exit', (code, sig) => (sig ? process.kill(process.pid, sig) : process.exit(code ?? 0)))
child.on('error', e => { process.stderr.write(String(e) + '\\n'); process.exit(1) })
`

export function launchCommand(def: McpServerDef, secrets: Record<string, string>, dir: string): { command: string; args: string[]; env: Record<string, string>; cleanup(): void } {
  if (def.transport.kind !== 'stdio') throw new Error('Só MCP por comando passa pelo lançador.')
  if (!Object.keys(secrets).length) return { command: def.transport.command, args: def.transport.args, env: {}, cleanup: () => {} }
  const launcher = join(dir, 'tutti-mcp-launch.cjs')
  if (!existsSync(launcher)) writeFileSync(launcher, LAUNCHER_JS, { mode: 0o600 })
  const file = join(dir, `mcp-${randomUUID()}.json`)
  writeFileSync(file, JSON.stringify({ command: def.transport.command, args: def.transport.args, env: secrets }), { mode: 0o600 })
  return { command: process.execPath, args: [launcher, file], env: { ELECTRON_RUN_AS_NODE: '1' }, cleanup: () => rmSync(file, { force: true }) }
}
