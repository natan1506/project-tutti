// Spike: Claude Agent SDK roda pela assinatura, sem config pessoal, e aciona canUseTool?
import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const cwd = mkdtempSync(join(tmpdir(), 'spike-claude-'))
execFileSync('git', ['init', '-q'], { cwd })
const env = { ...process.env }
delete env.ANTHROPIC_API_KEY

const asked = []
const q = query({
  prompt: "Rode o comando 'ls' e depois crie hello.txt com o conteúdo 'oi'. Responda curto.",
  options: {
    cwd, model: 'claude-sonnet-5-5', env,
    settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [],
    permissionMode: 'default',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Responda em português.' },
    canUseTool: async (toolName, input) => {
      asked.push(toolName)
      console.log('[canUseTool]', toolName, JSON.stringify(input).slice(0, 120))
      return { behavior: 'allow', updatedInput: input }
    },
  },
})
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') {
    const { apiKeySource, model, tools, mcp_servers, plugins, skills, slash_commands } = m
    console.log('[init]', JSON.stringify({ apiKeySource, model, tools, mcp_servers, plugins, skills, slash_commands: slash_commands?.length }))
  } else if (m.type === 'assistant') {
    for (const b of m.message.content) console.log('[assistant]', b.type, b.type === 'text' ? b.text : JSON.stringify(b.input ?? '').slice(0, 120))
  } else if (m.type === 'result') {
    console.log('[result]', m.subtype, 'session', m.session_id, 'is_error', m.is_error)
  } else console.log('[msg]', m.type, m.subtype ?? '')
}
console.log('hello.txt existe?', existsSync(join(cwd, 'hello.txt')), 'canUseTool para:', asked)
