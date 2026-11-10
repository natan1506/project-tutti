import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isReadTool, validateMcp, type McpServerDef, type McpTransport } from '@shared/mcp'
import type { KeyStore } from '../keys/keyStore'
import type { Store } from '../store/db'
import { probeMcp } from './probe'

// MCPs instalados no Tutti (spec mcps §2): guardados no banco (sem segredos), segredos no Keychain, testados ao salvar.

const KEY = 'mcps'
const secretKey = (id: string, name: string) => `mcp:${id}:${name}`

export class McpService {
  private listeners = new Set<() => void>()
  /** Salvamentos em fila: o teste de conexão demora, e dois ao mesmo tempo não podem se sobrescrever. */
  private queue: Promise<unknown> = Promise.resolve()
  private probe: typeof probeMcp

  constructor(private deps: { store: Store; keys: KeyStore; homeDir: string; probe?: typeof probeMcp }) {
    this.probe = deps.probe ?? probeMcp
  }

  all(): McpServerDef[] {
    return this.deps.store.getSetting<McpServerDef[]>(KEY) ?? []
  }

  private write(list: McpServerDef[]): void {
    this.deps.store.setSetting(KEY, list)
    for (const fn of this.listeners) fn()
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  secretsOf(id: string): Record<string, string> {
    const def = this.all().find(d => d.id === id)
    if (!def) return {}
    const out: Record<string, string> = {}
    for (const n of def.secretNames) { const v = this.deps.keys.getSecret(secretKey(id, n)); if (v !== undefined) out[n] = v }
    return out
  }

  /** Valida, guarda os segredos, testa a conexão e classifica as ferramentas; falhou → salvo desligado com o erro. */
  save(raw: unknown, secrets: Record<string, string> = {}): Promise<{ ok: true; def: McpServerDef } | { ok: false; errors: string[] }> {
    const run = this.queue.then(() => this.saveNow(raw, secrets))
    this.queue = run.catch(() => {})
    return run
  }

  private async saveNow(raw: unknown, secrets: Record<string, string>): Promise<{ ok: true; def: McpServerDef } | { ok: false; errors: string[] }> {
    const list = this.all()
    const r = raw as Partial<McpServerDef>
    const id = r.id && list.some(d => d.id === r.id) ? r.id : `mcp_${randomUUID()}`
    const prev = list.find(d => d.id === id)
    const v = validateMcp({ tools: [], enabled: true, ...r, id, secretNames: [...new Set([...(r.secretNames ?? []), ...Object.keys(secrets)])] }, list)
    if (!v.ok) return v
    for (const [n, value] of Object.entries(secrets)) this.deps.keys.setSecret(secretKey(id, n), value)
    const probed = await this.probe(v.def, { ...this.secretsOf(id), ...secrets })
    const def: McpServerDef = probed.ok
      ? {
        ...v.def, enabled: v.def.enabled, lastError: undefined,
        // Ajustes que o Natan fez continuam valendo; ferramenta nova é classificada pela regra.
        // Num MCP já salvo, ferramenta que apareceu agora entra como escrita até o Natan rever (spec §4).
        tools: probed.tools.map(t => ({ name: t.name, read: prev ? (prev.tools.find(p => p.name === t.name)?.read ?? false) : isReadTool(t.name, t.annotations) })).sort((a, b) => a.name.localeCompare(b.name)),
      }
      : { ...v.def, enabled: false, lastError: probed.error }
    if (!def.lastError) delete def.lastError
    // Relê a lista: o que mudou enquanto o teste de conexão rodava (ligar, desligar, ferramentas) continua valendo.
    const now = this.all()
    const cur = now.find(d => d.id === id)
    const changedMeanwhile = cur && prev && cur.enabled !== prev.enabled
    this.write([...now.filter(d => d.id !== id), changedMeanwhile ? { ...def, enabled: probed.ok && cur.enabled } : def])
    return { ok: true, def }
  }

  remove(id: string): void {
    const def = this.all().find(d => d.id === id)
    for (const n of def?.secretNames ?? []) this.deps.keys.removeSecret(secretKey(id, n))
    this.write(this.all().filter(d => d.id !== id))
  }

  setTool(id: string, tool: string, read: boolean): void {
    this.write(this.all().map(d => (d.id === id ? { ...d, tools: d.tools.map(t => (t.name === tool ? { ...t, read } : t)) } : d)))
  }

  /** Modo e quem usa, sem testar de novo (as ferramentas reclassificadas ficam). */
  setAccess(id: string, mode: McpServerDef['mode'], agents: McpServerDef['agents']): void {
    this.write(this.all().map(d => (d.id === id ? { ...d, mode, agents } : d)))
  }

  /** Quem usa todas as ferramentas sem pedir (ver `freeAgents`). */
  setFreeAgents(id: string, freeAgents: string[]): void {
    this.write(this.all().map(d => (d.id === id ? { ...d, freeAgents } : d)))
  }

  setEnabled(id: string, enabled: boolean): void {
    this.write(this.all().map(d => (d.id === id ? { ...d, enabled } : d)))
  }

  private claudeCode(): Record<string, { type?: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> }> {
    try { return JSON.parse(readFileSync(join(this.deps.homeDir, '.claude.json'), 'utf8')).mcpServers ?? {} } catch { return {} }
  }

  /** MCPs do Claude Code (~/.claude.json) que ainda não estão no Tutti. */
  importableFromClaudeCode(): { nome: string; transport: McpTransport }[] {
    const have = new Set(this.all().map(d => d.nome))
    return Object.entries(this.claudeCode()).flatMap(([nome, c]): { nome: string; transport: McpTransport }[] => {
      if (have.has(nome)) return []
      if (c.url) return [{ nome, transport: { kind: 'http' as const, url: c.url } }]
      if (c.command) return [{ nome, transport: { kind: 'stdio' as const, command: c.command, args: c.args ?? [] } }]
      return []
    })
  }

  /** Entra só leitura e para todos; o Playwright entra desligado (o navegador do Tutti já cobre os agentes Claude). */
  async importFromClaudeCode(nome: string): Promise<{ ok: true; def: McpServerDef } | { ok: false; errors: string[] }> {
    const item = this.importableFromClaudeCode().find(i => i.nome === nome)
    if (!item) return { ok: false, errors: [`O Claude Code não tem um MCP chamado "${nome}" para importar.`] }
    const env = this.claudeCode()[nome]?.env ?? {}
    const r = await this.save({ id: '', nome, transport: item.transport, secretNames: Object.keys(env), mode: 'read', agents: 'all', enabled: true, tools: [], source: 'claude-code' }, env)
    if (r.ok && nome === 'playwright') this.setEnabled(r.def.id, false)
    return r.ok && nome === 'playwright' ? { ok: true, def: { ...r.def, enabled: false } } : r
  }

  /** Uma vez: o Linear que o cérebro usava direto do Claude Code passa a ser um MCP do Tutti. */
  async seedLinear(): Promise<void> {
    if (this.deps.store.getSetting<boolean>('seed:mcp-linear')) return
    this.deps.store.setSetting('seed:mcp-linear', true)
    if (this.importableFromClaudeCode().some(i => i.nome === 'linear')) await this.importFromClaudeCode('linear')
  }
}
