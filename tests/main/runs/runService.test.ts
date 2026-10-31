import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent, RunEvent } from '@shared/events'
import type { AdapterRunOptions, AgentAdapter } from '../../../src/main/adapters/types'
import { runGit } from '../../../src/main/git/git'
import { snapshot } from '../../../src/main/git/checkpoint'
import { openStore } from '../../../src/main/store/db'
import { RunService } from '../../../src/main/runs/runService'

type Script = (opts: AdapterRunOptions) => AsyncGenerator<AgentEvent>
class FakeAdapter implements AgentAdapter {
  seen?: AdapterRunOptions
  constructor(private script: Script) {}
  run(opts: AdapterRunOptions) { this.seen = opts; return this.script(opts) }
}

async function setup(script: Script, { git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'run-'))
  if (git) {
    await runGit(dir, ['init', '-q'])
    writeFileSync(join(dir, 'a.txt'), 'a\n')
  }
  const store = openStore(':memory:')
  const project = store.upsertProject(dir)
  const conv = store.createConversation(project.id, 't')
  const emitted: RunEvent[] = []
  const fake = new FakeAdapter(script)
  const svc = new RunService({
    store, adapters: { claude: fake, codex: undefined, gemini: undefined, opencode: undefined },
    emit: (_id, ev) => emitted.push(ev), homeDir: mkdtempSync(join(tmpdir(), 'home-')),
  })
  const start = (prompt = 'faz') => svc.start({ projectPath: dir, conversationId: conv.id, agentId: 'forja', prompt })
  return { dir, store, conv, emitted, fake, svc, start }
}
const types = (evs: RunEvent[]) => evs.map(e => e.type)
const waitFor = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 10)) }

describe('RunService', () => {
  it('caminho feliz: eventos em ordem, diff, sessão e refs', async () => {
    const { dir, store, conv, emitted, svc, start } = await setup(async function* (o) {
      yield { type: 'text', text: 'oi' }
      writeFileSync(join(o.cwd, 'novo.ts'), 'x\n')
      yield { type: 'done', sessionId: 's1' }
    })
    const runId = await start()
    await svc.whenFinished(runId)
    expect(types(emitted)).toEqual(['run_started', 'text', 'done', 'diff', 'run_finished'])
    expect(emitted[3]).toEqual({ type: 'diff', files: [{ path: 'novo.ts', status: 'A', added: 1, removed: 0 }] })
    expect(emitted[4]).toEqual({ type: 'run_finished', status: 'done' })
    expect(store.listEvents(runId)).toEqual(emitted)
    expect(store.listRuns(conv.id)[0]).toMatchObject({ status: 'done', sessionId: 's1' })
    await runGit(dir, ['rev-parse', `refs/time/runs/${runId}/before`, `refs/time/runs/${runId}/after`])
  })

  it('passa instruções, pasta e agente ao adaptador', async () => {
    const { dir, fake, svc, start } = await setup(async function* () { yield { type: 'done' } })
    writeFileSync(join(dir, 'CLAUDE.md'), 'use pnpm')
    await svc.whenFinished(await start('pedido X'))
    expect(fake.seen).toMatchObject({ cwd: dir, prompt: 'pedido X', agent: { id: 'forja' } })
    expect(fake.seen!.instructions).toContain('use pnpm')
  })

  it('recusa pasta sem git sem criar run', async () => {
    const { store, conv, start } = await setup(async function* () { yield { type: 'done' } }, { git: false })
    await expect(start()).rejects.toThrow('NOT_A_GIT_REPO')
    expect(store.listRuns(conv.id)).toEqual([])
  })

  it('recusa agente que só chega na Fase 3', async () => {
    const { svc, dir, conv } = await setup(async function* () { yield { type: 'done' } })
    await expect(svc.start({ projectPath: dir, conversationId: conv.id, agentId: 'radar', prompt: 'x' })).rejects.toThrow('AGENT_NOT_AVAILABLE')
  })

  it('aprovação vai e volta', async () => {
    let answer: boolean | undefined
    const { emitted, svc, start } = await setup(async function* (o) {
      answer = await o.requestApproval({ toolName: 'Bash', summary: 'npm install x' })
      yield { type: 'done' }
    })
    const runId = await start()
    await waitFor(() => emitted.some(e => e.type === 'approval_request'))
    const req = emitted.find(e => e.type === 'approval_request') as Extract<RunEvent, { type: 'approval_request' }>
    expect(req).toMatchObject({ toolName: 'Bash', summary: 'npm install x' })
    svc.respondApproval(req.id, true)
    await svc.whenFinished(runId)
    expect(answer).toBe(true)
    expect(emitted).toContainEqual({ type: 'approval_resolved', id: req.id, allowed: true })
  })

  it('cancelar com aprovação pendente nega, aborta e fecha o run', async () => {
    let answer: boolean | undefined, aborted = false
    const { store, conv, emitted, svc, start } = await setup(async function* (o) {
      writeFileSync(join(o.cwd, 'parcial.ts'), 'p\n')
      answer = await o.requestApproval({ toolName: 'Bash', summary: 'rm x' })
      aborted = o.signal.aborted
    })
    const runId = await start()
    await waitFor(() => emitted.some(e => e.type === 'approval_request'))
    svc.cancel(runId)
    await svc.whenFinished(runId)
    expect(answer).toBe(false)
    expect(aborted).toBe(true)
    expect(emitted.at(-1)).toEqual({ type: 'run_finished', status: 'cancelled' })
    expect(emitted.find(e => e.type === 'diff')).toEqual({ type: 'diff', files: [{ path: 'parcial.ts', status: 'A', added: 1, removed: 0 }] })
    expect(store.listRuns(conv.id)[0].status).toBe('cancelled')
  })

  it('erro do adaptador termina como error e ainda grava o diff', async () => {
    const { emitted, svc, start } = await setup(async function* (o) {
      writeFileSync(join(o.cwd, 'meio.ts'), 'm\n')
      throw new Error('CLI caiu')
    })
    await svc.whenFinished(await start())
    expect(types(emitted)).toEqual(['run_started', 'error', 'diff', 'run_finished'])
    expect(emitted[1]).toEqual({ type: 'error', message: 'CLI caiu' })
    expect(emitted.at(-1)).toEqual({ type: 'run_finished', status: 'error' })
  })

  it('evento de erro do adaptador também termina como error', async () => {
    const { emitted, svc, start } = await setup(async function* () { yield { type: 'error', message: 'limite' } })
    await svc.whenFinished(await start())
    expect(emitted.at(-1)).toEqual({ type: 'run_finished', status: 'error' })
  })

  it('desfaz o que o agente escreveu', async () => {
    const { dir, svc, start } = await setup(async function* (o) {
      writeFileSync(join(o.cwd, 'novo.ts'), 'x\n')
      yield { type: 'done' }
    })
    const runId = await start()
    await svc.whenFinished(runId)
    expect(await svc.undo(runId)).toEqual({ ok: true })
    expect(existsSync(join(dir, 'novo.ts'))).toBe(false)
  })

  it('recover marca interrompido; sem ponto final, desfazer fica indisponível', async () => {
    const { store, conv, svc } = await setup(async function* () { yield { type: 'done' } })
    store.createRun({ id: 'orfao', conversationId: conv.id, agentId: 'forja', prompt: 'x', startedAt: 1, hasCheckpoint: true })
    await svc.recover()
    expect(store.getRun('orfao')!.status).toBe('interrupted')
    expect(await svc.undo('orfao')).toEqual({ ok: false, conflicts: [] })
  })
  it('recover grava o ponto final do run interrompido e permite desfazer', async () => {
    const { dir, store, conv, svc } = await setup(async function* () { yield { type: 'done' } })
    store.createRun({ id: 'caiu', conversationId: conv.id, agentId: 'forja', prompt: 'x', startedAt: 1, hasCheckpoint: true })
    await snapshot(dir, 'refs/time/runs/caiu/before')
    writeFileSync(join(dir, 'do-agente.ts'), 'a\n')
    await svc.recover()
    expect(store.listEvents('caiu')).toContainEqual({ type: 'diff', files: [{ path: 'do-agente.ts', status: 'A', added: 1, removed: 0 }] })
    expect(await svc.undo('caiu')).toEqual({ ok: true })
    expect(existsSync(join(dir, 'do-agente.ts'))).toBe(false)
  })

  it('não começa um segundo pedido no mesmo projeto enquanto o primeiro roda', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const { svc, start } = await setup(async function* () { await gate; yield { type: 'done' } })
    const first = await start()
    await expect(start()).rejects.toThrow('PROJECT_BUSY')
    release()
    await svc.whenFinished(first)
    await svc.whenFinished(await start())
  })

  it('falha no ponto final ainda fecha o run como error', async () => {
    const { dir, store, conv, emitted, svc, start } = await setup(async function* () {
      yield { type: 'text', text: 'apagando .git' }
      rmSync(join(dir, '.git'), { recursive: true, force: true })
    })
    const runId = await start()
    await svc.whenFinished(runId)
    expect(emitted.at(-1)).toEqual({ type: 'run_finished', status: 'error' })
    expect(emitted.some(e => e.type === 'error')).toBe(true)
    expect(store.listRuns(conv.id)[0].status).toBe('error')
  })

  it('cancelar logo após começar não chama o agente', async () => {
    const { fake, emitted, svc, start } = await setup(async function* () { yield { type: 'done' } })
    const runId = await start()
    svc.cancel(runId)
    await svc.whenFinished(runId)
    expect(fake.seen).toBeUndefined()
    expect(emitted.at(-1)).toEqual({ type: 'run_finished', status: 'cancelled' })
  })
})
