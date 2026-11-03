import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolKind } from '@shared/agents'
import type { AgentEvent } from '@shared/events'
import type { AdapterRunOptions, AgentAdapter } from '../../../src/main/adapters/types'
import { openStore } from '../../../src/main/store/db'
import { RunService } from '../../../src/main/runs/runService'

function setup(script: (o: AdapterRunOptions) => AsyncGenerator<AgentEvent>, toolReady?: (t: ToolKind) => Promise<boolean>) {
  const calls: AdapterRunOptions[] = []
  const fake: AgentAdapter = { run: o => { calls.push(o); return script(o) } }
  const store = openStore(':memory:')
  const usage: { runId: string; agentId: string }[] = []
  const svc = new RunService({
    store, adapters: { claude: fake, codex: undefined, gemini: undefined, opencode: undefined }, emit: () => {}, homeDir: mkdtempSync(join(tmpdir(), 'home-')), toolReady,
    onUsage: (runId, agentId) => usage.push({ runId, agentId }),
  })
  return { svc, calls, usage, store }
}

describe('consultOnce', () => {
  it('roda em consulta, junta os textos e registra o uso no id dado', async () => {
    const { svc, calls, usage, store } = setup(async function* () {
      yield { type: 'text', text: 'um' }
      yield { type: 'usage', tool: 'claude', tokens: { input: 10, output: 2, cacheRead: 0, reasoning: 0 } }
      yield { type: 'text', text: 'dois' }
      yield { type: 'done' }
    })
    const out = await svc.consultOnce({ usageRunId: 'skill:d1', agentId: 'forja', prompt: 'faz', cwd: '/tmp', instructions: 'regras', signal: new AbortController().signal })
    expect(out).toBe('um\n\ndois')
    expect(calls[0]).toMatchObject({ mode: 'consult', prompt: 'faz', cwd: '/tmp', instructions: 'regras' })
    expect(usage).toEqual([{ runId: 'skill:d1', agentId: 'forja' }])
    expect(store.tokensSince('claude', 0).input).toBe(10)
  })

  it('ferramenta indisponível: AGENT_UNAVAILABLE sem chamar o agente', async () => {
    const { svc, calls } = setup(async function* () { yield { type: 'done' } }, async () => false)
    await expect(svc.consultOnce({ usageRunId: 'x', agentId: 'forja', prompt: 'p', cwd: '/tmp', signal: new AbortController().signal })).rejects.toThrow('AGENT_UNAVAILABLE')
    expect(calls).toHaveLength(0)
  })

  it('I-3: cancelado enquanto confere a disponibilidade não chama o agente', async () => {
    const ctl = new AbortController()
    let ready!: (v: boolean) => void
    const { svc, calls } = setup(async function* () { yield { type: 'done' } }, () => new Promise(r => { ready = r }))
    const p = svc.consultOnce({ usageRunId: 'x', agentId: 'forja', prompt: 'p', cwd: '/tmp', signal: ctl.signal })
    await new Promise(r => setTimeout(r, 10))
    ctl.abort()
    ready(true)
    await expect(p).rejects.toThrow('CANCELED')
    expect(calls).toHaveLength(0)
  })

  it('I-6: estourar o prazo é TIMEOUT, não cancelamento', async () => {
    const { svc } = setup(async function* (o) {
      await new Promise(r => o.signal.addEventListener('abort', r))
      throw new Error('abortado')
    })
    await expect(svc.consultOnce({ usageRunId: 'x', agentId: 'forja', prompt: 'p', cwd: '/tmp', signal: new AbortController().signal, timeoutMs: 20 })).rejects.toThrow('TIMEOUT')
  })

  it('cancelado: CANCELED', async () => {
    const ctl = new AbortController()
    const { svc } = setup(async function* (o) {
      await new Promise(r => o.signal.addEventListener('abort', r))
      throw new Error('abortado')
    })
    const p = svc.consultOnce({ usageRunId: 'x', agentId: 'forja', prompt: 'p', cwd: '/tmp', signal: ctl.signal })
    setTimeout(() => ctl.abort(), 20)
    await expect(p).rejects.toThrow('CANCELED')
  })
})
