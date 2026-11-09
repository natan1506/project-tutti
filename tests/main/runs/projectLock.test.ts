import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent, RunEvent } from '@shared/events'
import type { AdapterRunOptions, AgentAdapter } from '../../../src/main/adapters/types'
import { runGit } from '../../../src/main/git/git'
import { tryLock, unlock, waitLock } from '../../../src/main/runs/projectLock'
import { RunService } from '../../../src/main/runs/runService'
import { openStore } from '../../../src/main/store/db'

describe('trava de projeto entre processos', () => {
  it('o primeiro dono pega; o segundo só depois de soltar', () => {
    const s = openStore(':memory:')
    expect(tryLock(s, '/p', 'a', 111, () => true)).toBe(true)
    expect(tryLock(s, '/p', 'b', 222, () => true)).toBe(false)
    unlock(s, '/p', 'a')
    expect(tryLock(s, '/p', 'b', 222, () => true)).toBe(true)
  })

  it('soltar com outro dono não solta', () => {
    const s = openStore(':memory:')
    tryLock(s, '/p', 'a', 111, () => true)
    unlock(s, '/p', 'b')
    expect(tryLock(s, '/p', 'b', 222, () => true)).toBe(false)
  })

  it('trava de processo morto é tomada', () => {
    const s = openStore(':memory:')
    tryLock(s, '/p', 'a', 111, () => true)
    expect(tryLock(s, '/p', 'b', 222, pid => pid !== 111)).toBe(true)
  })

  it('waitLock devolve false quando o sinal aborta enquanto espera', async () => {
    const s = openStore(':memory:')
    tryLock(s, '/p', 'a', 111, () => true)
    const ctl = new AbortController()
    const p = waitLock(s, '/p', 'b', ctl.signal, 10)
    setTimeout(() => ctl.abort(), 30)
    expect(await p).toBe(false)
  })

  it('erro na trava fecha o pedido com erro e não prende a fila do projeto', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lockerr-'))
    await runGit(dir, ['init', '-q'])
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    const store = openStore(':memory:')
    let fail = true
    const lock = store.lockProject.bind(store)
    store.lockProject = (...a) => { if (fail) { fail = false; throw new Error('database is locked') } return lock(...a) }
    const done: AgentAdapter = { async *run(): AsyncGenerator<AgentEvent> { yield { type: 'done' } } }
    const svc = new RunService({ store, adapters: { claude: done, codex: undefined, gemini: undefined, opencode: undefined }, emit: () => {}, homeDir: mkdtempSync(join(tmpdir(), 'h-')) })
    const conv = store.createConversation(store.upsertProject(dir).id, 't')
    const first = await svc.start({ projectPath: dir, conversationId: conv.id, agentId: 'forja', prompt: '1' })
    await svc.whenFinished(first)
    expect(store.getRun(first)!.status).toBe('error')
    const second = await svc.start({ projectPath: dir, conversationId: conv.id, agentId: 'forja', prompt: '2' })
    await svc.whenFinished(second)
    expect(store.getRun(second)!.status).toBe('done')
  })

  it('dois processos no mesmo projeto: o segundo espera o primeiro terminar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-'))
    await runGit(dir, ['init', '-q'])
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    const file = join(mkdtempSync(join(tmpdir(), 'db-')), 'time.db')
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const order: string[] = []
    const mk = (name: string) => {
      const store = openStore(file)
      const emitted: RunEvent[] = []
      const adapter: AgentAdapter = {
        async *run(_o: AdapterRunOptions): AsyncGenerator<AgentEvent> { order.push(name); if (name === 'app') await gate; yield { type: 'done' } },
      }
      const svc = new RunService({ store, adapters: { claude: adapter, codex: undefined, gemini: undefined, opencode: undefined }, emit: (_id, ev) => emitted.push(ev), homeDir: mkdtempSync(join(tmpdir(), 'h-')) })
      const conv = store.createConversation(store.upsertProject(dir).id, name)
      return { svc, emitted, start: () => svc.start({ projectPath: dir, conversationId: conv.id, agentId: 'forja', prompt: name }) }
    }
    const app = mk('app'), term = mk('terminal')
    const a = await app.start()
    for (let i = 0; i < 100 && order.length === 0; i++) await new Promise(r => setTimeout(r, 10))
    const b = await term.start()
    await new Promise(r => setTimeout(r, 300))
    expect(order).toEqual(['app'])
    expect(term.emitted).toContainEqual({ type: 'queued', position: 1 })
    release()
    await app.svc.whenFinished(a)
    await term.svc.whenFinished(b)
    expect(order).toEqual(['app', 'terminal'])
  })
})
