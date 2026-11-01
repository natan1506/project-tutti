// Spike: consultar o uso do Claude sem fazer pedido (sessão com entrada em stream que nunca manda mensagem).
import { query } from '@anthropic-ai/claude-agent-sdk'
import { tmpdir } from 'node:os'

const env = {}
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ANTHROPIC_API_KEY' && k !== 'CLAUDECODE' && !k.startsWith('CLAUDE_CODE_')) env[k] = v
let stop
const idle = (async function* () { await new Promise(r => { stop = r }) })()
const q = query({ prompt: idle, options: { cwd: tmpdir(), env, model: 'claude-haiku-5-5', settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [], skills: [] } })
const t0 = Date.now()
const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }).catch(e => ({ erro: e.message }))
console.log('[usage ocioso]', Date.now() - t0 + 'ms', JSON.stringify(u.erro ? u : { five_hour: u.rate_limits?.five_hour?.utilization, seven_day: u.rate_limits?.seven_day?.utilization, cost: u.session?.total_cost_usd }))
stop(); q.interrupt?.().catch(() => {}); setTimeout(() => process.exit(0), 500)
