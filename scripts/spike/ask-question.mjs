// Spike: formato do AskUserQuestion do Claude e como devolver a resposta pelo canUseTool.
import { query } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const cwd = mkdtempSync(join(tmpdir(), 'spike-ask-'))
execFileSync('git', ['init', '-q'], { cwd })
const env = {}
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ANTHROPIC_API_KEY' && k !== 'CLAUDECODE' && !k.startsWith('CLAUDE_CODE_')) env[k] = v

const q = query({
  prompt: 'Antes de começar, use a ferramenta AskUserQuestion para me perguntar qual nome dar ao arquivo, com duas opções sugeridas. Depois crie o arquivo com o nome que eu escolher, contendo "ok". Responda curto.',
  options: {
    cwd, model: 'claude-sonnet-5-5', env, settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [], skills: [],
    permissionMode: 'default', systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Responda em português.' },
    canUseTool: async (toolName, input) => {
      if (toolName === 'AskUserQuestion') {
        console.log('[ask input]', JSON.stringify(input))
        const answers = Object.fromEntries((input.questions ?? []).map(qq => [qq.question, 'resposta-teste.txt']))
        return { behavior: 'allow', updatedInput: { ...input, answers } }
      }
      return { behavior: 'allow', updatedInput: input }
    },
  },
})
for await (const m of q) {
  if (m.type === 'assistant') for (const b of m.message.content) if (b.type === 'tool_use') console.log('[tool_use]', b.name, JSON.stringify(b.input).slice(0, 150))
  if (m.type === 'user') for (const b of m.message.content ?? []) if (b.type === 'tool_result') console.log('[tool_result]', JSON.stringify(b.content).slice(0, 200))
  if (m.type === 'result') console.log('[result]', m.subtype, (m.result ?? '').slice(0, 150))
}
console.log('arquivos:', readdirSync(cwd).filter(f => f !== '.git'), 'resposta-teste.txt?', existsSync(join(cwd, 'resposta-teste.txt')))
