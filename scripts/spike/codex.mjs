// Spike: Codex SDK roda pela assinatura em modo só-leitura?
import { Codex } from '@openai/codex-sdk'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cwd = mkdtempSync(join(tmpdir(), 'spike-codex-'))
writeFileSync(join(cwd, 'hello.txt'), 'oi\n')
const env = { ...process.env }
delete env.OPENAI_API_KEY

const codex = new Codex({ env, config: { mcp_servers: {} } })
const thread = codex.startThread({ workingDirectory: cwd, sandboxMode: 'read-only', approvalPolicy: 'never', skipGitRepoCheck: true })
const { events } = await thread.runStreamed('Liste os arquivos e diga o que há em hello.txt. Depois tente criar x.txt com "x". Responda curto em português.')
for await (const ev of events) console.log('[event]', JSON.stringify(ev).slice(0, 300))
console.log('thread id', thread.id, 'x.txt existe?', existsSync(join(cwd, 'x.txt')))
