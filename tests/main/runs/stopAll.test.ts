import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent, RunEvent } from '@shared/events'
import type { AdapterRunOptions, AgentAdapter } from '../../../src/main/adapters/types'
import { runGit } from '../../../src/main/git/git'
import { openStore } from '../../../src/main/store/db'
import { RunService } from '../../../src/main/runs/runService'

const waitFor = async (cond: () => boolean) => { for (let i = 0; i < 300 && !cond(); i++) await new Promise(r => setTimeout(r, 10)) }

async function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'stop-'))
  await runGit(dir, ['init', '-q'])
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  return dir
}

/** Agente que escreve um arquivo e fica esperando até ser cancelado (ou pede aprovação, se `approval`). */
function setup(approval = false) {
  const calls: AdapterRunOptions[] = []
  const fake: AgentAdapter = {
    async *run(o): AsyncGenerator<AgentEvent> {
      calls.push(o)
      writeFileSync(join(o.cwd, `feito-${calls.length}.txt`), 'x\n')
      yield { type: 'file_changed', path: `feito-${calls.length}.txt` }
      if (approval) await o.requestApproval({ toolName: 'Bash', summary: 'rm -rf x', reason: 'destructive' })
      if (!o.signal.aborted) await new Promise(r => o.signal.addEventListener('abort', r, { once: true }))
    },
  }
  const store = openStore(':memory:')
  const emitted: { runId: string; ev: RunEvent }[] = []
  const activity: number[] = []
  const svc = new RunService({
    store, adapters: { claude: fake, codex: fake, gemini: fake, opencode: fake }, emit: (runId, ev) => emitted.push({ runId, ev }),
    homeDir: mkdtempSync(join(tmpdir(), 'home-')), onActivity: n => activity.push(n),
  })
  const conv = (dir: string) => store.createConversation(store.upsertProject(dir).id, 't').id
  return { svc, calls, store, emitted, activity, conv }
}

describe('Parar tudo', () => {
  it('cancela pedidos de todos os projetos e a fila; o que já foi feito fica no diff', async () => {
    const { svc, calls, store, emitted, conv } = setup()
    const [p1, p2] = [await repo(), await repo()]
    const a = await svc.start({ projectPath: p1, conversationId: conv(p1), agentId: 'forja', prompt: 'um' })
    const b = await svc.start({ projectPath: p2, conversationId: conv(p2), agentId: 'pincel', prompt: 'dois' })
    const c = await svc.start({ projectPath: p1, conversationId: conv(p1), agentId: 'pincel', prompt: 'fila' })
    await waitFor(() => calls.length === 2)
    expect(svc.cancelAll()).toBe(3)
    await Promise.all([a, b, c].map(id => svc.whenFinished(id)))
    expect([a, b, c].map(id => store.getRun(id)!.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
    expect(calls).toHaveLength(2)
    const diffs = emitted.filter(e => e.ev.type === 'diff' && (e.runId === a || e.runId === b))
    expect(diffs).toHaveLength(2)
    expect(existsSync(join(p1, 'feito-1.txt'))).toBe(true)
  })

  it('aprovação pendente fecha negada', async () => {
    const { svc, calls, emitted, conv } = setup(true)
    const p = await repo()
    const id = await svc.start({ projectPath: p, conversationId: conv(p), agentId: 'forja', prompt: 'x' })
    await waitFor(() => emitted.some(e => e.ev.type === 'approval_request'))
    svc.cancelAll()
    await svc.whenFinished(id)
    expect(calls).toHaveLength(1)
    expect(emitted.map(e => e.ev)).toContainEqual(expect.objectContaining({ type: 'approval_resolved', allowed: false }))
  })

  it('avisa quantos pedidos estão ativos; sem nada rodando devolve 0 e não lança', async () => {
    const { svc, activity, conv } = setup()
    expect(svc.cancelAll()).toBe(0)
    expect(svc.activeCount()).toBe(0)
    const p = await repo()
    const id = await svc.start({ projectPath: p, conversationId: conv(p), agentId: 'forja', prompt: 'x' })
    await waitFor(() => svc.activeCount() === 1)
    svc.cancelAll()
    await svc.whenFinished(id)
    expect(activity[0]).toBe(1)
    expect(activity.at(-1)).toBe(0)
    expect(svc.activeCount()).toBe(0)
  })
})
