import type { AgentDef } from '@shared/agents'
import { readToolNames, type McpServerDef } from '@shared/mcp'
import { launchCommand } from './launcher'

// Quem recebe qual MCP e com quais ferramentas (spec mcps §3): escrita só no Claude por CLI (com aprovação a cada uso);
// Codex, opencode e APIs só leitura; consulta nada; Playwright não vai para quem tem o navegador do Tutti.

/** `allowed: 'all'` só em agente Claude com MCP "pode escrever"; senão, a lista de ferramentas de leitura. */
export interface AgentMcp { def: McpServerDef; allowed: string[] | 'all'; secrets: Record<string, string> }

const claudeCli = (a: AgentDef) => a.transport.kind === 'cli' && a.tool === 'claude'

export function mcpForAgent(agent: AgentDef, defs: McpServerDef[], o: { mode?: 'work' | 'consult'; hasTuttiBrowser: boolean; secretsOf(id: string): Record<string, string> }): AgentMcp[] {
  if (o.mode === 'consult') return []
  return defs.flatMap(def => {
    if (!def.enabled) return []
    if (def.agents !== 'all' && !def.agents.includes(agent.id)) return []
    if (def.nome === 'playwright' && o.hasTuttiBrowser) return []
    // Claude por CLI segue pedindo aprovação a cada escrita; o agente liberado recebe tudo direto.
    const free = !claudeCli(agent) && !!def.freeAgents?.includes(agent.id)
    const allowed = free ? def.tools.map(t => t.name) : claudeCli(agent) && def.mode === 'write' ? 'all' as const : readToolNames(def)
    if (allowed !== 'all' && !allowed.length) return []
    return [{ def, allowed, secrets: o.secretsOf(def.id) }]
  })
}

/** Ferramenta pedida pelo agente (`mcp__<nome>__<ferramenta>`): leitura, escrita (pede aprovação) ou negada. */
export function isAllowedMcpTool(mcps: AgentMcp[], toolName: string): 'read' | 'write' | 'deny' {
  const m = toolName.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/)
  if (!m) return 'deny'
  const hit = mcps.find(x => x.def.nome === m[1])
  if (!hit) return 'deny'
  if (readToolNames(hit.def).includes(m[2]) || (Array.isArray(hit.allowed) && hit.allowed.includes(m[2]))) return 'read'
  return hit.allowed === 'all' ? 'write' : 'deny'
}

/** MCP pronto para o adaptador: como iniciar (já pelo lançador, se houver segredo) e o que pode ser usado. */
export interface ResolvedMcp {
  nome: string
  launch: { kind: 'stdio'; command: string; args: string[]; env: Record<string, string> } | { kind: 'http'; url: string }
  read: string[]
  write: boolean
}

/** Prepara os MCPs de um pedido; `cleanup` apaga os arquivos de segredo que o lançador ainda não leu. */
/**
 * `direct`: segredo vai no próprio env da config, sem lançador — só para quem grava a config num arquivo 0600 que
 * nunca vai para a linha de comando (o opencode.json, como as chaves de API).
 */
export function resolveMcps(mcps: AgentMcp[], dir: string, o: { direct?: boolean } = {}): { list: ResolvedMcp[]; cleanup(): void } {
  const cleanups: (() => void)[] = []
  const list = mcps.map(m => {
    const base = { nome: m.def.nome, read: m.allowed === 'all' ? readToolNames(m.def) : m.allowed, write: m.allowed === 'all' }
    if (m.def.transport.kind === 'http') return { ...base, launch: { kind: 'http' as const, url: m.def.transport.url } }
    if (o.direct) return { ...base, launch: { kind: 'stdio' as const, command: m.def.transport.command, args: m.def.transport.args, env: m.secrets } }
    const l = launchCommand(m.def, m.secrets, dir)
    cleanups.push(l.cleanup)
    return { ...base, launch: { kind: 'stdio' as const, command: l.command, args: l.args, env: l.env } }
  })
  return { list, cleanup: () => cleanups.forEach(c => c()) }
}

/** Mesma regra de `isAllowedMcpTool`, para os MCPs já prontos no adaptador. */
export function mcpToolAccess(mcps: ResolvedMcp[], toolName: string): 'read' | 'write' | 'deny' | 'not-mcp' {
  const m = toolName.match(/^mcp__(.+?)__(.+)$/)
  if (!m) return 'not-mcp'
  const hit = mcps.find(x => x.nome === m[1])
  if (!hit) return 'deny'
  if (hit.read.includes(m[2])) return 'read'
  return hit.write ? 'write' : 'deny'
}
