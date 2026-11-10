import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeBrain, LINEUP_SCHEMA, TRIAGE_SCHEMA } from '../../../src/main/team/brain'

function fakeQuery(result: Record<string, unknown>) {
  const seen: { prompt: string; options: Options }[] = []
  const fn = ((p: { prompt: string; options: Options }) => {
    seen.push(p)
    return (async function* () { yield { type: 'system', subtype: 'init' }; yield { type: 'result', ...result } })()
  }) as never
  return { fn, seen }
}
const input = { cwd: '/p', prompt: 'Crie /health', available: ['forja', 'pincel'] as const, signal: new AbortController().signal }

describe('ClaudeBrain', () => {
  it('triagem: JSON por esquema, sem ferramentas, modelo sonnet, lê structured_output', async () => {
    const q = fakeQuery({ subtype: 'success', structured_output: { scores: [], candidates: [], big: false } })
    const out = await new ClaudeBrain(q.fn).triage({ ...input, available: [...input.available] })
    expect(out).toEqual({ scores: [], candidates: [], big: false })
    const o = q.seen[0].options
    expect(o.outputFormat).toEqual({ type: 'json_schema', schema: TRIAGE_SCHEMA })
    expect(o.model).toBe('claude-sonnet-5-5')
    for (const t of ['Write', 'Edit', 'Bash', 'Read']) expect(o.disallowedTools).toContain(t)
    expect(o).toMatchObject({ settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [] })
    expect(q.seen[0].prompt).toContain('Crie /health')
  })

  it('escalação usa o esquema da escalação', async () => {
    const q = fakeQuery({ subtype: 'success', structured_output: { steps: [] } })
    await new ClaudeBrain(q.fn).lineup({ ...input, available: [...input.available], triage: { scores: [], candidates: [], big: false }, confirmations: [] })
    expect(q.seen[0].options.outputFormat).toEqual({ type: 'json_schema', schema: LINEUP_SCHEMA })
  })

  it('o gasto do cérebro vai para o uso (plano e revisão contam)', async () => {
    const q = fakeQuery({ subtype: 'success', structured_output: { tarefa: 't', pronto: 'p' }, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 } })
    const seen: unknown[] = []
    await new ClaudeBrain(q.fn).plan({ cwd: '/p', prompt: 'x', cerebro: 'bussola', signal: new AbortController().signal, onUsage: ev => seen.push(ev) })
    expect(seen).toEqual([{ type: 'usage', tool: 'claude', tokens: { input: 100, output: 20, cacheRead: 5, reasoning: 0 } }])
  })

  it('falha de saída estruturada vira exceção', async () => {
    const q = fakeQuery({ subtype: 'error_max_structured_output_retries' })
    await expect(new ClaudeBrain(q.fn).triage({ ...input, available: [...input.available] })).rejects.toThrow(/error_max_structured_output_retries/)
  })
})

describe('ClaudeBrain na esteira: o que o Natan configurou no Claude Code', () => {
  function home() {
    const h = mkdtempSync(join(tmpdir(), 'home-'))
    const sk = join(h, '.claude', 'skills', 'entregar-card')
    mkdirSync(sk, { recursive: true })
    writeFileSync(join(sk, 'SKILL.md'), '---\nname: entregar-card\ndescription: Use ao entregar um card\n---\nLeia o card.')
    return h
  }
  const signal = new AbortController().signal

  it('plano: instruções do projeto no pedido, Linear ligado só para leitura, skills como plugin', async () => {
    const h = home()
    const q = fakeQuery({ subtype: 'success', structured_output: { tarefa: 't', pronto: 'p' } })
    const linear = { id: 'm', nome: 'linear', transport: { kind: 'stdio' as const, command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'] }, secretNames: [], mode: 'write' as const, agents: 'all' as const, enabled: true, tools: [{ name: 'get_issue', read: true }, { name: 'save_issue', read: false }] }
    const mcpFor = (id: string) => (id === 'bussola' ? [{ def: linear, allowed: 'all' as const, secrets: {} }] : [])
    await new ClaudeBrain(q.fn, { homeDir: h, pluginDir: join(h, 'plug'), mcpFor }).plan({ cwd: '/p', prompt: 'entrega o ABC-1', cerebro: 'bussola', signal, instructions: 'use pnpm sempre' })
    const { prompt, options: o } = q.seen[0]
    expect(prompt).toContain('use pnpm sempre')
    expect(prompt).toContain('Linear')
    expect(Object.keys(o.mcpServers!)).toEqual(['linear'])
    const ask = (name: string) => o.canUseTool!(name, {}, { signal } as never)
    expect(await ask('mcp__linear__get_issue')).toMatchObject({ behavior: 'allow' })
    expect(await ask('mcp__linear__save_issue')).toMatchObject({ behavior: 'deny' })
    expect(await ask('Bash')).toMatchObject({ behavior: 'deny' })
    expect(o.skills).toContain('tutti:entregar-card')
    expect(o.plugins).toHaveLength(1)
  })

  it('triagem continua sem Linear e sem skills', async () => {
    const h = home()
    const q = fakeQuery({ subtype: 'success', structured_output: { scores: [], candidates: [], big: false } })
    await new ClaudeBrain(q.fn, { homeDir: h, pluginDir: join(h, 'plug') }).triage({ ...input, available: [...input.available] })
    expect(q.seen[0].options.mcpServers).toEqual({})
    expect(q.seen[0].options.plugins).toEqual([])
  })
})
