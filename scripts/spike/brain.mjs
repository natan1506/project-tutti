// Spike da Fase 3B: saída JSON por esquema e ferramenta própria (MCP in-process) no Claude Agent SDK.
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cwd = mkdtempSync(join(tmpdir(), 'spike-brain-'))
const env = {}
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ANTHROPIC_API_KEY' && k !== 'CLAUDECODE' && !k.startsWith('CLAUDE_CODE_')) env[k] = v
const base = { cwd, env, settingSources: [], strictMcpConfig: true, plugins: [], skills: [], permissionMode: 'default' }
const NO_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'Task', 'Read', 'Glob', 'Grep', 'TodoWrite']

// 1) JSON por esquema
const schema = {
  type: 'object', additionalProperties: false, required: ['scores', 'candidates', 'big'],
  properties: {
    scores: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['agentId', 'score', 'line'], properties: { agentId: { type: 'string' }, score: { type: 'integer' }, line: { type: 'string' } } } },
    candidates: { type: 'array', items: { type: 'string' } },
    big: { type: 'boolean' },
  },
}
const t0 = Date.now()
for await (const m of query({
  prompt: 'Pedido: "Crie um endpoint /health e uma página de status". Agentes: forja (back-end), pincel (front-end), radar (pesquisa), lupa (revisão). Dê nota 0-100 e uma frase curta para cada, escolha 2 candidatos.',
  options: { ...base, model: 'claude-sonnet-5-5', disallowedTools: NO_TOOLS, mcpServers: {}, outputFormat: { type: 'json_schema', schema } },
})) {
  if (m.type === 'result') console.log('[json]', m.subtype, (Date.now() - t0) + 'ms', JSON.stringify(m.structured_output), 'result?', typeof m.result)
}

// 2) Ferramenta própria
const asked = []
const server = createSdkMcpServer({
  name: 'tutti',
  tools: [tool('perguntar_ao_time', 'Pergunta algo ao Radar (pesquisa) ou ao Lupa (revisão)', { agente: z.enum(['radar', 'lupa']), pergunta: z.string() },
    async a => { asked.push(a); return { content: [{ type: 'text', text: 'Radar diz: Node 26 LTS' }] } })],
})
for await (const m of query({
  prompt: 'Use a ferramenta perguntar_ao_time para perguntar ao Radar qual a versão LTS do Node, e me diga a resposta em uma linha.',
  options: { ...base, model: 'claude-sonnet-5-5', mcpServers: { tutti: server },
    canUseTool: async (name, input) => { console.log('[canUseTool]', name); return { behavior: 'allow', updatedInput: input } } },
})) {
  if (m.type === 'assistant') for (const b of m.message.content) if (b.type === 'tool_use') console.log('[tool_use]', b.name, JSON.stringify(b.input))
  if (m.type === 'result') console.log('[result]', m.subtype, m.result)
}
console.log('handler recebeu:', JSON.stringify(asked))
