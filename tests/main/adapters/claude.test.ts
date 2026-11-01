import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAgent } from '@shared/agents'
import type { AdapterRunOptions } from '../../../src/main/adapters/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildClaudeOptions, makeCanUseTool, mapClaudeMessage } from '../../../src/main/adapters/claude'

const cwd = '/tmp/proj'
const opts = (o: Partial<AdapterRunOptions> = {}): AdapterRunOptions => ({
  agent: getAgent('forja'), prompt: 'faz', cwd, instructions: 'REGRAS DO NATAN', signal: new AbortController().signal,
  requestApproval: vi.fn(async () => true), ...o,
})
const msg = (m: unknown) => m as SDKMessage
const signal = new AbortController().signal

describe('buildClaudeOptions', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-x'; process.env.ANTHROPIC_AUTH_TOKEN = 't'; process.env.ANTHROPIC_BASE_URL = 'http://x'; process.env.CLAUDECODE = '1'; process.env.CLAUDE_CODE_ENTRYPOINT = 'desktop'
  })
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN; delete process.env.ANTHROPIC_BASE_URL; delete process.env.CLAUDECODE; delete process.env.CLAUDE_CODE_ENTRYPOINT
  })

  it('isola a configuração pessoal e usa a assinatura', () => {
    const o = buildClaudeOptions(opts({ resumeSessionId: 's1' }), async () => ({ behavior: 'allow' }))
    expect(o).toMatchObject({
      settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [], skills: [],
      permissionMode: 'default', cwd, model: 'claude-sonnet-5-5', resume: 's1',
    })
    const sp = o.systemPrompt as { type: string; preset: string; append: string }
    expect(sp).toMatchObject({ type: 'preset', preset: 'claude_code' })
    expect(sp.append).toContain(getAgent('forja').persona)
    expect(sp.append).toContain('REGRAS DO NATAN')
    expect(o.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(o.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(o.env).not.toHaveProperty('ANTHROPIC_BASE_URL')
    expect(o.env).not.toHaveProperty('CLAUDECODE')
    expect(o.env).not.toHaveProperty('CLAUDE_CODE_ENTRYPOINT')
    expect(o.env).toHaveProperty('PATH')
  })

  it('usa o modelo pedido quando informado', () => {
    expect(buildClaudeOptions(opts({ model: 'claude-haiku-5-5' }), async () => ({ behavior: 'allow' })).model).toBe('claude-haiku-5-5')
  })
})

describe('mapClaudeMessage', () => {
  it('texto do assistente', () => {
    expect(mapClaudeMessage(msg({ type: 'assistant', message: { content: [{ type: 'text', text: 'oi' }] } }), cwd))
      .toEqual([{ type: 'text', text: 'oi' }])
  })
  it('comando Bash vira passo', () => {
    expect(mapClaudeMessage(msg({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }), cwd))
      .toEqual([{ type: 'tool', name: 'Bash', summary: 'npm test' }])
  })
  it('edição vira passo + arquivo alterado', () => {
    expect(mapClaudeMessage(msg({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: cwd + '/src/a.ts' } }] } }), cwd))
      .toEqual([{ type: 'tool', name: 'Edit', summary: 'src/a.ts' }, { type: 'file_changed', path: 'src/a.ts' }])
  })
  it('resultado com sucesso', () => {
    expect(mapClaudeMessage(msg({ type: 'result', subtype: 'success', is_error: false, session_id: 's9' }), cwd))
      .toEqual([{ type: 'done', sessionId: 's9' }])
  })
  it('resultado com erro', () => {
    expect(mapClaudeMessage(msg({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's9', errors: ['quebrou'] }), cwd))
      .toEqual([{ type: 'error', message: 'quebrou' }])
  })
  it('ignora o resto', () => {
    expect(mapClaudeMessage(msg({ type: 'system', subtype: 'init' }), cwd)).toEqual([])
    expect(mapClaudeMessage(msg({ type: 'user', message: { content: [] } }), cwd)).toEqual([])
  })
})

describe('makeCanUseTool', () => {
  it('libera leitura dentro do projeto sem perguntar', async () => {
    const o = opts()
    const r = await makeCanUseTool(o)('Read', { file_path: cwd + '/a.ts' }, { signal, toolUseID: 't' } as never)
    expect(r).toEqual({ behavior: 'allow', updatedInput: { file_path: cwd + '/a.ts' } })
    expect(o.requestApproval).not.toHaveBeenCalled()
  })
  it('pergunta ao Natan e respeita o sim', async () => {
    const o = opts()
    const r = await makeCanUseTool(o)('Bash', { command: 'npm install x' }, { signal, toolUseID: 't' } as never)
    expect(o.requestApproval).toHaveBeenCalledWith({ toolName: 'Bash', summary: 'npm install x' })
    expect(r).toEqual({ behavior: 'allow', updatedInput: { command: 'npm install x' } })
  })
  it('respeita o não', async () => {
    const o = opts({ requestApproval: vi.fn(async () => false) })
    const r = await makeCanUseTool(o)('Bash', { command: 'rm a' }, { signal, toolUseID: 't' } as never)
    expect(r).toEqual({ behavior: 'deny', message: 'Natan negou este comando.' })
  })
  it('AskUserQuestion pergunta ao Natan e devolve as respostas no formato do SDK', async () => {
    const askUser = vi.fn(async (q: { text: string; options?: string[] }) => (q.text.startsWith('Qual nome') ? 'pergunta-ok.js' : 'sim'))
    const o = opts({ askUser })
    const input = { questions: [
      { question: 'Qual nome dar ao arquivo?', header: 'Nome', multiSelect: false, options: [{ label: 'a.js', description: '' }, { label: 'b.js', description: '' }] },
      { question: 'Posso sobrescrever?', header: 'OK', multiSelect: false, options: [] },
    ] }
    const r = await makeCanUseTool(o)('AskUserQuestion', input, { signal, toolUseID: 't' } as never)
    expect(askUser).toHaveBeenCalledWith({ text: 'Qual nome dar ao arquivo?', options: ['a.js', 'b.js'] })
    expect(r).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { 'Qual nome dar ao arquivo?': 'pergunta-ok.js', 'Posso sobrescrever?': 'sim' } } })
    expect(o.requestApproval).not.toHaveBeenCalled()
  })

  it('pergunta sem resposta (cancelada) manda o agente seguir com a suposição mais sensata', async () => {
    const r = await makeCanUseTool(opts({ askUser: async () => null }))('AskUserQuestion', { questions: [{ question: 'Q?', header: 'h', multiSelect: false, options: [] }] }, { signal, toolUseID: 't' } as never)
    expect(r).toEqual({ behavior: 'deny', message: 'O Natan não respondeu; siga com a opção mais sensata e registre a suposição.' })
  })
  it('modo consulta: nada de escrita, comando ou rede, sem perguntar ao Natan', async () => {
    const o = opts({ mode: 'consult' })
    const options = buildClaudeOptions(o, async () => ({ behavior: 'allow' }))
    for (const t of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'Task']) expect(options.disallowedTools).toContain(t)
    const can = makeCanUseTool(o)
    expect(await can('Edit', { file_path: cwd + '/a.ts' }, { signal, toolUseID: 't' } as never)).toMatchObject({ behavior: 'deny' })
    expect(await can('Bash', { command: 'ls' }, { signal, toolUseID: 't' } as never)).toMatchObject({ behavior: 'deny' })
    expect(await can('Read', { file_path: cwd + '/a.ts' }, { signal, toolUseID: 't' } as never)).toMatchObject({ behavior: 'allow' })
    expect(o.requestApproval).not.toHaveBeenCalled()
  })

  it('modo trabalho não muda', () => {
    expect(buildClaudeOptions(opts(), async () => ({ behavior: 'allow' })).disallowedTools).toBeUndefined()
  })
  it('com askAgent: servidor tutti, MCP estrito, ferramenta e ToolSearch liberados sem perguntar', async () => {
    const o = opts({ askAgent: async () => 'ok' })
    const options = buildClaudeOptions(o, async () => ({ behavior: 'allow' }))
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['tutti'])
    expect(options.strictMcpConfig).toBe(true)
    const can = makeCanUseTool(o)
    expect(await can('mcp__tutti__perguntar_ao_time', { agente: 'radar', pergunta: 'x' }, { signal, toolUseID: 't' } as never)).toMatchObject({ behavior: 'allow' })
    expect(await can('ToolSearch', { query: 'select:mcp__tutti__perguntar_ao_time' }, { signal, toolUseID: 't' } as never)).toMatchObject({ behavior: 'allow' })
    expect(o.requestApproval).not.toHaveBeenCalled()
  })
  it('sem askAgent (ou em consulta) não há servidor', () => {
    expect(buildClaudeOptions(opts(), async () => ({ behavior: 'allow' })).mcpServers).toEqual({})
    expect(buildClaudeOptions(opts({ askAgent: async () => '', mode: 'consult' }), async () => ({ behavior: 'allow' })).mcpServers).toEqual({})
  })
})

describe('uso e limite do Claude', () => {
  const fx = (n: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', n), 'utf8'))
  it('rate_limit_event vira um limite por janela, em 0–100 e milissegundos', () => {
    expect(mapClaudeMessage(fx('claude-rate-limit.json'), cwd)).toEqual([
      { type: 'limit', limit: { tool: 'claude', window: 'five_hour', utilization: 28, resetsAt: 1793541000_000, at: expect.any(Number) } },
      { type: 'limit', limit: { tool: 'claude', window: 'seven_day', utilization: 86, resetsAt: 1793584800_000, at: expect.any(Number) } },
    ])
  })
  it('janela por modelo vira seven_day_model; evento sem unifiedWindows usa o topo', () => {
    const ev = msg({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'seven_day_opus', utilization: 0.5, resetsAt: 10 } })
    expect(mapClaudeMessage(ev, cwd)).toEqual([{ type: 'limit', limit: { tool: 'claude', window: 'seven_day_model', utilization: 50, resetsAt: 10_000, at: expect.any(Number) } }])
  })
  it('resultado com usage emite tokens antes do fim', () => {
    expect(mapClaudeMessage(fx('claude-result-usage.json'), cwd)).toEqual([
      { type: 'usage', tool: 'claude', tokens: { input: 10057, output: 4, cacheRead: 300, reasoning: 7 } },
      { type: 'done', sessionId: 's9' },
    ])
  })
})
