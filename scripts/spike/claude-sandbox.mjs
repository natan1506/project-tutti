// Spike (autonomia, Task 1): o sandbox do Agent SDK no macOS barra escrita fora do projeto e em .git/config?
// Uso: node scripts/spike/claude-sandbox.mjs
import { query } from '@anthropic-ai/claude-agent-sdk'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const cwd = mkdtempSync(join(tmpdir(), 'spike-sbx-'))
execFileSync('git', ['init', '-q'], { cwd })
const fora = join(homedir(), 'tutti-sandbox-fora.txt')
rmSync(fora, { force: true })
const configBefore = readFileSync(join(cwd, '.git/config'), 'utf8')

const env = { ...process.env }
for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || /API_KEY|AUTH_TOKEN/.test(k)) delete env[k]
const calls = []
const q = query({
  prompt: 'Rode exatamente estes comandos Bash, um por vez, e mostre a saída de cada um: 1) touch dentro.txt 2) touch ~/tutti-sandbox-fora.txt 3) echo x >> .git/config 4) curl -sI https://example.com | head -1',
  options: {
    cwd, env, model: 'claude-haiku-5-5', settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [], skills: [],
    sandbox: { enabled: true, autoAllowBashIfSandboxed: false, failIfUnavailable: false, filesystem: { allowWrite: [cwd], denyWrite: [join(cwd, '.git/hooks'), join(cwd, '.git/config')] } },
    canUseTool: async (toolName, input) => { calls.push({ toolName, command: input.command }); return { behavior: 'allow', updatedInput: input } },
  },
})
let init
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') {
    init = m
    console.log('init keys:', Object.keys(m).join(','))
    for (const k of Object.keys(m)) if (/sandbox/i.test(k)) console.log('init.' + k + ' =', JSON.stringify(m[k]))
  }
  if (m.type === 'system' && m.subtype !== 'init') console.log('system', m.subtype, JSON.stringify(m).slice(0, 300))
  if (m.type === 'user') for (const c of m.message?.content ?? []) if (c.type === 'tool_result') console.log('tool_result:', JSON.stringify(c.content).slice(0, 300))
  if (m.type === 'result') console.log('result:', m.subtype, (m.result ?? '').slice(0, 600))
}
try {
  const r = await q.initializationResult?.()
  if (r) for (const k of Object.keys(r)) if (/sandbox/i.test(k)) console.log('initializationResult.' + k + ' =', JSON.stringify(r[k]))
} catch (e) { console.log('initializationResult indisponível:', e.message) }
console.log('canUseTool chamado para:', JSON.stringify(calls))
console.log('dentro.txt existe:', existsSync(join(cwd, 'dentro.txt')))
console.log('fora existe:', existsSync(fora))
console.log('.git/config mudou:', readFileSync(join(cwd, '.git/config'), 'utf8') !== configBefore)
rmSync(fora, { force: true })
