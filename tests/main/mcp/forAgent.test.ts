import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getAgent } from '@shared/agents'
import type { McpServerDef } from '@shared/mcp'
import { isAllowedMcpTool, mcpForAgent, resolveMcps } from '../../../src/main/mcp/forAgent'
import { LAUNCHER_JS, launchCommand } from '../../../src/main/mcp/launcher'

const def = (o: Partial<McpServerDef> = {}): McpServerDef => ({
  id: 'm1', nome: 'fake', transport: { kind: 'stdio', command: 'node', args: ['fake.mjs'] }, secretNames: [], mode: 'write', agents: 'all', enabled: true,
  tools: [{ name: 'get_thing', read: true }, { name: 'save_thing', read: false }], ...o,
})
const o = { hasTuttiBrowser: false, secretsOf: () => ({}) }
const claude = getAgent('forja'), codex = getAgent('lupa'), opencode = getAgent('curinga')

describe('o que cada agente recebe', () => {
  it('Claude com MCP de escrita recebe tudo; Codex e opencode só a leitura', () => {
    expect(mcpForAgent(claude, [def()], o)[0].allowed).toBe('all')
    expect(mcpForAgent(codex, [def()], o)[0].allowed).toEqual(['get_thing'])
    expect(mcpForAgent(opencode, [def()], o)[0].allowed).toEqual(['get_thing'])
    expect(mcpForAgent(claude, [def({ mode: 'read' })], o)[0].allowed).toEqual(['get_thing'])
  })
  it('consulta, desligado e agente fora da lista não recebem', () => {
    expect(mcpForAgent(claude, [def()], { ...o, mode: 'consult' })).toEqual([])
    expect(mcpForAgent(claude, [def({ enabled: false })], o)).toEqual([])
    expect(mcpForAgent(claude, [def({ agents: ['lupa'] })], o)).toEqual([])
    expect(mcpForAgent(codex, [def({ agents: ['lupa'] })], o)).toHaveLength(1)
  })
  it('Playwright não vai para quem tem o navegador do Tutti', () => {
    expect(mcpForAgent(claude, [def({ nome: 'playwright' })], { ...o, hasTuttiBrowser: true })).toEqual([])
    expect(mcpForAgent(claude, [def({ nome: 'playwright' })], o)).toHaveLength(1)
  })
  it('agente liberado (ex.: tester com Playwright) usa todas as ferramentas, sem pedir; os outros seguem só leitura', () => {
    const d = def({ mode: 'read', freeAgents: ['lupa'] })
    const x = mcpForAgent(codex, [d], o)
    expect(x[0].allowed).toEqual(['get_thing', 'save_thing'])
    expect(isAllowedMcpTool(x, 'mcp__fake__save_thing')).toBe('read')
    expect(resolveMcps(x, mkdtempSync(join(tmpdir(), 'r-'))).list[0].read).toEqual(['get_thing', 'save_thing'])
    expect(mcpForAgent(opencode, [d], o)[0].allowed).toEqual(['get_thing'])
  })
  it('liberado com só ferramentas de escrita ainda recebe', () => {
    expect(mcpForAgent(codex, [def({ tools: [{ name: 'browser_click', read: false }], freeAgents: ['lupa'] })], o)).toHaveLength(1)
  })
  it('sem nenhuma ferramenta de leitura, quem só lê não recebe o MCP', () => {
    expect(mcpForAgent(codex, [def({ tools: [{ name: 'save_thing', read: false }] })], o)).toEqual([])
  })
  it('ferramenta permitida: leitura, escrita (só Claude com write) ou negada', () => {
    const c = mcpForAgent(claude, [def()], o), x = mcpForAgent(codex, [def()], o)
    expect(isAllowedMcpTool(c, 'mcp__fake__get_thing')).toBe('read')
    expect(isAllowedMcpTool(c, 'mcp__fake__save_thing')).toBe('write')
    expect(isAllowedMcpTool(x, 'mcp__fake__save_thing')).toBe('deny')
    expect(isAllowedMcpTool(c, 'mcp__outro__get_x')).toBe('deny')
    expect(isAllowedMcpTool(c, 'Bash')).toBe('deny')
  })
  it('ferramenta nova (fora da lista salva) é escrita no Claude e negada no Codex', () => {
    expect(isAllowedMcpTool(mcpForAgent(claude, [def()], o), 'mcp__fake__get_novo')).toBe('write')
    expect(isAllowedMcpTool(mcpForAgent(codex, [def()], o), 'mcp__fake__get_novo')).toBe('deny')
  })
})

describe('lançador: segredo fora da linha de comando', () => {
  it('sem segredo, o comando original', () => {
    const r = launchCommand(def(), {}, mkdtempSync(join(tmpdir(), 'l-')))
    expect(r).toMatchObject({ command: 'node', args: ['fake.mjs'], env: {} })
  })
  it('com segredo: nada do valor no comando, nos argumentos ou no env; o filho recebe e o arquivo some', () => {
    const dir = mkdtempSync(join(tmpdir(), 'l-'))
    const child = join(dir, 'child.mjs')
    writeFileSync(child, "process.stdout.write(process.env.TOKEN ?? 'nada')")
    const r = launchCommand(def({ transport: { kind: 'stdio', command: process.execPath, args: [child] } }), { TOKEN: 'segredo-xyz' }, dir)
    expect(JSON.stringify([r.command, r.args, r.env])).not.toContain('segredo-xyz')
    expect(existsSync(r.args[0])).toBe(true)
    // O MCP pode subir mais de uma vez no mesmo pedido: o arquivo fica até o fim do pedido (cleanup).
    expect(execFileSync(r.command, r.args, { env: { ...process.env, ...r.env }, encoding: 'utf8' })).toBe('segredo-xyz')
    expect(execFileSync(r.command, r.args, { env: { ...process.env, ...r.env }, encoding: 'utf8' })).toBe('segredo-xyz')
    r.cleanup()
    expect(readdirSync(dir).filter(f => f.endsWith('.json'))).toEqual([])
    expect(LAUNCHER_JS).not.toContain('unlinkSync')
  })
})

describe('revisão: opencode recebe o segredo direto no opencode.json 0600', () => {
  it('direct: sem lançador, sem arquivo no disco, env com o segredo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'l-'))
    const r = resolveMcps(mcpForAgent(codex, [def()], { ...o, secretsOf: () => ({ T: 's' }) }), dir, { direct: true })
    expect(r.list[0].launch).toEqual({ kind: 'stdio', command: 'node', args: ['fake.mjs'], env: { T: 's' } })
    expect(readdirSync(dir)).toEqual([])
  })
})
