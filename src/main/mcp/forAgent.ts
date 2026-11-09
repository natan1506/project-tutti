import type { AgentDef } from '@shared/agents'
import { readToolNames, type McpServerDef } from '@shared/mcp'

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
    const allowed = claudeCli(agent) && def.mode === 'write' ? 'all' as const : readToolNames(def)
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
  if (readToolNames(hit.def).includes(m[2])) return 'read'
  return hit.allowed === 'all' ? 'write' : 'deny'
}
