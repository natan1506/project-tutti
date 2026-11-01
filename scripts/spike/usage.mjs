// Spike: uso e limites do Claude (rate_limit_event, usage do result e consulta de uso experimental).
import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cwd = mkdtempSync(join(tmpdir(), 'spike-uso-'))
const env = {}
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ANTHROPIC_API_KEY' && k !== 'CLAUDECODE' && !k.startsWith('CLAUDE_CODE_')) env[k] = v
const q = query({
  prompt: 'Responda só: ok',
  options: { cwd, env, model: 'claude-haiku-5-5', settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [], skills: [], permissionMode: 'default' },
})
let asked = false
for await (const m of q) {
  if (m.type === 'rate_limit_event') console.log('[rate_limit_event]', JSON.stringify(m.rate_limit_info))
  if (m.type === 'system' && m.subtype === 'init' && !asked) {
    asked = true
    const t0 = Date.now()
    q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
      .then(u => console.log('[usage durante]', Date.now() - t0 + 'ms', JSON.stringify({ subscription_type: u.subscription_type, rate_limits_available: u.rate_limits_available, rate_limits: u.rate_limits })))
      .catch(e => console.log('[usage durante erro]', e.message))
  }
  if (m.type === 'result') {
    console.log('[result.usage]', JSON.stringify(m.usage), 'modelUsage', JSON.stringify(m.modelUsage ?? m.model_usage ?? null).slice(0, 300))
    if (!asked) {
      asked = true
      const t0 = Date.now()
      try {
        const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
        console.log('[usage]', Date.now() - t0 + 'ms', JSON.stringify({ subscription_type: u.subscription_type, rate_limits_available: u.rate_limits_available, rate_limits: u.rate_limits }))
      } catch (e) { console.log('[usage erro]', e.message) }
    }
  }
}
