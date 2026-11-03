// Spike (skills, Task 1): skill como plugin local do Agent SDK, sem mandar mensagem ao modelo.
// Uso: node scripts/spike/claude-skill-plugin.mjs
import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'spike-skill-'))
mkdirSync(join(dir, '.claude-plugin'))
writeFileSync(join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'tutti', version: '0.0.0' }))
mkdirSync(join(dir, 'skills/ola-mundo'), { recursive: true })
writeFileSync(join(dir, 'skills/ola-mundo/SKILL.md'), '---\nname: ola-mundo\ndescription: Use quando pedirem um olá.\n---\nResponda "olá, mundo".\n')

const abortController = new AbortController()
// Prompt que nunca produz mensagem: só inicializa a sessão.
async function* idle() { await new Promise(r => abortController.signal.addEventListener('abort', r)) }
const env = { ...process.env }
for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || /API_KEY/.test(k)) delete env[k]
const q = query({ prompt: idle(), options: {
  abortController, cwd: homedir(), env, settingSources: [], strictMcpConfig: true, mcpServers: {},
  plugins: [{ type: 'local', path: dir }], skills: ['tutti:ola-mundo'],
} })
try {
  const cmds = await q.supportedCommands()
  console.log('comandos com "ola":', cmds.filter(c => /ola/.test(c.name)).map(c => `${c.name} — ${c.description}`))
  console.log('total de comandos:', cmds.length)
} finally {
  abortController.abort()
}
