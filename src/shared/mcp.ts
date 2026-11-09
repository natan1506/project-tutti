import { z } from 'zod'

// MCPs instalados no Tutti (spec mcps): o que cada um é, e quais ferramentas contam como leitura.

export type McpMode = 'read' | 'write'
export interface McpToolInfo { name: string; read: boolean }
export type McpTransport = { kind: 'stdio'; command: string; args: string[] } | { kind: 'http'; url: string }
export interface McpServerDef {
  id: string
  /** Nome curto e único ([a-z0-9-]): vira o prefixo das ferramentas (mcp__<nome>__<ferramenta>). */
  nome: string
  transport: McpTransport
  /** Nomes das variáveis secretas; os valores ficam no Keychain. */
  secretNames: string[]
  mode: McpMode
  /** 'all' acompanha agentes novos; senão, ids dos agentes que recebem. */
  agents: 'all' | string[]
  enabled: boolean
  tools: McpToolInfo[]
  lastError?: string
  source?: 'claude-code'
}

const READ_PREFIX = /^(get|list|search|read|fetch|find|query|describe|view|show|extract)(_|[A-Z]|$)/
const READ_EXACT = new Set(['browser_snapshot', 'browser_take_screenshot'])

/** Leitura pelo nome (get_, list…, camelCase também) ou pela anotação do MCP; destrutiva é sempre escrita. */
export function isReadTool(name: string, annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }): boolean {
  if (annotations?.destructiveHint) return false
  if (annotations?.readOnlyHint) return true
  return READ_PREFIX.test(name) || READ_EXACT.has(name)
}

export const readToolNames = (def: McpServerDef): string[] => def.tools.filter(t => t.read).map(t => t.name)

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const schema = z.object({
  id: z.string().max(80),
  nome: z.string().max(40),
  transport: z.union([
    z.object({ kind: z.literal('stdio'), command: z.string().max(500), args: z.array(z.string().max(2000)).max(50) }),
    z.object({ kind: z.literal('http'), url: z.string().max(2000) }),
  ]),
  secretNames: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(20),
  mode: z.enum(['read', 'write']),
  agents: z.union([z.literal('all'), z.array(z.string().max(80)).max(50)]),
  enabled: z.boolean(),
  tools: z.array(z.object({ name: z.string().max(200), read: z.boolean() })).max(500),
  lastError: z.string().max(2000).optional(),
  source: z.literal('claude-code').optional(),
})

export function validateMcp(raw: unknown, others: McpServerDef[]): { ok: true; def: McpServerDef } | { ok: false; errors: string[] } {
  const p = schema.safeParse(raw)
  if (!p.success) return { ok: false, errors: ['MCP inválido.'] }
  const def = p.data as McpServerDef
  const errors: string[] = []
  if (!NAME_RE.test(def.nome)) errors.push('Nome: só letras minúsculas, números e hífen (ex.: linear).')
  if (others.some(o => o.nome === def.nome && o.id !== def.id)) errors.push(`Já existe um MCP chamado "${def.nome}".`)
  if (def.transport.kind === 'stdio' && !def.transport.command.trim()) errors.push('Informe o comando que inicia o MCP.')
  if (def.transport.kind === 'http' && !/^https?:\/\//.test(def.transport.url)) errors.push('A URL precisa começar com http:// ou https://.')
  return errors.length ? { ok: false, errors } : { ok: true, def }
}

/** Linha "comando arg1 arg2" do formulário, separada como no shell (aspas simples e duplas agrupam). */
export function splitCommandLine(line: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const m of line.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}
