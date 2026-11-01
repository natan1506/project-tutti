import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAgent, registerAgents } from '@shared/agents'
import { resolveAgentDefs, type Profile, type ProviderId } from '@shared/profiles'
import { describe, expect, it } from 'vitest'
import type { ToolKind } from '@shared/agents'
import type { AgentEvent, RunEvent } from '@shared/events'
import type { AdapterRunOptions, AgentAdapter } from '../../../src/main/adapters/types'
import { runGit } from '../../../src/main/git/git'
import { snapshot } from '../../../src/main/git/checkpoint'
import { openStore } from '../../../src/main/store/db'
import { RunService } from '../../../src/main/runs/runService'

type Script = (opts: AdapterRunOptions) => AsyncGenerator<AgentEvent>
class FakeAdapter implements AgentAdapter {
  seen?: AdapterRunOptions
  calls: AdapterRunOptions[] = []
  constructor(private script: Script) {}
  run(opts: AdapterRunOptions) { this.seen = opts; this.calls.push(opts); return this.script(opts) }
}

async function setup(script: Script, { git = true, toolReady, radar = false, all = false, keyReady }: { git?: boolean; toolReady?: (t: ToolKind) => Promise<boolean>; radar?: boolean; all?: boolean; keyReady?: (p: ProviderId) => boolean } = {}) {
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
    store, adapters: { claude: fake, codex: all ? fake : undefined, gemini: radar || all ? fake : undefined, opencode: all ? fake : undefined },
    emit: (_id, ev) => emitted.push(ev), homeDir: mkdtempSync(join(tmpdir(), 'home-')), toolReady, keyReady,
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

  it('recusa agente cuja ferramenta não tem adaptador', async () => {
    const { svc, dir, conv, store } = await setup(async function* () { yield { type: 'done' } })
    await expect(svc.start({ projectPath: dir, conversationId: conv.id, agentId: 'radar', prompt: 'x' })).rejects.toThrow('TOOL_UNAVAILABLE')
    expect(store.listRuns(conv.id)).toEqual([])
  })

  it('recusa agente cuja ferramenta não está pronta (não instalada ou sem login)', async () => {
    const { svc, dir, conv, store } = await setup(async function* () { yield { type: 'done' } }, { toolReady: async t => t !== 'claude' })
    await expect(svc.start({ projectPath: dir, conversationId: conv.id, agentId: 'forja', prompt: 'x' })).rejects.toThrow('TOOL_UNAVAILABLE')
    expect(store.listRuns(conv.id)).toEqual([])
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

  it('segundo pedido no mesmo projeto espera na fila e começa sozinho', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const order: string[] = []
    const { svc, start, emitted } = await setup(async function* (o) { const p = o.prompt.split('\n').at(-1)!; order.push(p); if (p === 'um') await gate; yield { type: 'done' } })
    const first = await start('um')
    const second = await start('dois')
    await waitFor(() => emitted.some(e => e.type === 'queued') && order.length === 1)
    expect(emitted).toContainEqual({ type: 'queued', position: 1 })
    expect(order).toEqual(['um'])
    release()
    await svc.whenFinished(first)
    await svc.whenFinished(second)
    expect(order).toEqual(['um', 'dois'])
  })

  it('cancelar um pedido na fila tira ele de lá sem rodar nada', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const { svc, start, fake, dir } = await setup(async function* (o) { if (o.prompt === 'um') await gate; yield { type: 'done' } })
    const first = await start('um')
    const second = await start('dois')
    await waitFor(() => fake.calls.length === 1)
    svc.cancel(second)
    await svc.whenFinished(second)
    expect(fake.calls.map(c => c.prompt)).toEqual(['um'])
    await expect(runGit(dir, ['rev-parse', '--verify', '-q', `refs/time/runs/${second}/before`])).rejects.toThrow()
    release()
    await svc.whenFinished(first)
  })

  it('run-filho não usa fila nem ponto de restauração e guarda o pai', async () => {
    const { svc, start, store, emitted, dir } = await setup(async function* () { yield { type: 'done' } })
    const parent = await start('pai')
    await svc.whenFinished(parent)
    const child = await svc.startChild({ projectPath: dir, conversationId: store.getRun(parent)!.conversationId, agentId: 'forja', prompt: 'filho', parentRunId: parent })
    await svc.whenFinished(child)
    expect(store.getRun(child)).toMatchObject({ parentRunId: parent, status: 'done' })
    await expect(runGit(dir, ['rev-parse', '--verify', '-q', `refs/time/runs/${child}/before`])).rejects.toThrow()
    expect(emitted.filter(e => e.type === 'diff')).toHaveLength(1)
  })

  it('run que estava na fila quando o app fechou vira interrompido sem refs', async () => {
    const { store, conv, svc } = await setup(async function* () { yield { type: 'done' } })
    store.createRun({ id: 'na-fila', conversationId: conv.id, agentId: 'forja', prompt: 'x', startedAt: 1, hasCheckpoint: false })
    await svc.recover()
    expect(store.getRun('na-fila')!.status).toBe('interrupted')
    expect(await svc.undo('na-fila')).toEqual({ ok: false, conflicts: [] })
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
  it('segundo pedido ao mesmo agente na mesma conversa retoma a sessão; conversa nova não', async () => {
    const { fake, svc, start, store, conv, dir } = await setup(async function* () { yield { type: 'done', sessionId: 'sess-1' } })
    await svc.whenFinished(await start('primeiro'))
    await svc.whenFinished(await start('segundo'))
    expect(fake.calls.map(c => c.resumeSessionId)).toEqual([undefined, 'sess-1'])
    const nova = store.createConversation(store.upsertProject(dir).id, 'nova')
    await svc.whenFinished(await svc.start({ projectPath: dir, conversationId: nova.id, agentId: 'forja', prompt: 'x' }))
    expect(fake.calls.at(-1)!.resumeSessionId).toBeUndefined()
  })

  it('sessão que a CLI não reconhece mais: avisa e começa de novo uma vez', async () => {
    const { fake, emitted, svc, start, store, conv } = await setup(async function* (o) {
      if (o.resumeSessionId === 'sumiu') { yield { type: 'error', message: 'session not found' }; return }
      yield { type: 'text', text: 'ok' }
      yield { type: 'done', sessionId: 'nova' }
    })
    store.createRun({ id: 'antigo', conversationId: conv.id, agentId: 'forja', prompt: 'x', startedAt: 1, hasCheckpoint: true })
    store.finishRun('antigo', 'done', 'sumiu')
    const runId = await start()
    await svc.whenFinished(runId)
    expect(fake.calls.map(c => c.resumeSessionId)).toEqual(['sumiu', undefined])
    expect(emitted.map(e => e.type)).toEqual(['run_started', 'notice', 'text', 'done', 'diff', 'run_finished'])
    expect(emitted[1]).toEqual({ type: 'notice', text: 'Não consegui retomar a conversa anterior do Forja; comecei uma nova.' })
    expect(emitted.at(-1)).toEqual({ type: 'run_finished', status: 'done' })
  })

  it('erro depois de começar a trabalhar não repete o pedido', async () => {
    const { fake, svc, start, store, conv } = await setup(async function* () {
      yield { type: 'text', text: 'começando' }
      yield { type: 'error', message: 'caiu' }
    })
    store.createRun({ id: 'antigo', conversationId: conv.id, agentId: 'forja', prompt: 'x', startedAt: 1, hasCheckpoint: true })
    store.finishRun('antigo', 'done', 's1')
    await svc.whenFinished(await start())
    expect(fake.calls).toHaveLength(1)
  })
  it('pergunta vai ao Natan e a resposta volta ao agente', async () => {
    let answer: string | null | undefined
    const { emitted, svc, start } = await setup(async function* (o) {
      answer = await o.askUser!({ text: 'Qual nome?', options: ['a', 'b'] })
      yield { type: 'done' }
    })
    const runId = await start()
    await waitFor(() => emitted.some(e => e.type === 'question'))
    const q = emitted.find(e => e.type === 'question') as Extract<RunEvent, { type: 'question' }>
    expect(q).toMatchObject({ text: 'Qual nome?', options: ['a', 'b'] })
    svc.answerQuestion(q.id, 'b')
    await svc.whenFinished(runId)
    expect(answer).toBe('b')
    expect(emitted).toContainEqual({ type: 'question_answered', id: q.id, answer: 'b' })
  })

  it('cancelar com pergunta pendente resolve sem resposta e fecha o run', async () => {
    let answer: string | null | undefined = 'x'
    const { emitted, svc, start } = await setup(async function* (o) { answer = await o.askUser!({ text: 'Q?' }) })
    const runId = await start()
    await waitFor(() => emitted.some(e => e.type === 'question'))
    svc.cancel(runId)
    await svc.whenFinished(runId)
    expect(answer).toBeNull()
    expect(emitted.some(e => e.type === 'question_answered' && e.answer === null)).toBe(true)
    expect(emitted.at(-1)).toEqual({ type: 'run_finished', status: 'cancelled' })
  })
  it('I4: adaptador que lança exceção ao retomar sessão sumida também começa de novo', async () => {
    const { fake, emitted, svc, start, store, conv } = await setup(async function* (o) {
      if (o.resumeSessionId) throw new Error('No conversation found with session ID: sumiu')
      yield { type: 'done', sessionId: 'nova' }
    })
    store.createRun({ id: 'antigo', conversationId: conv.id, agentId: 'forja', prompt: 'x', startedAt: 1, hasCheckpoint: true })
    store.finishRun('antigo', 'done', 'sumiu')
    await svc.whenFinished(await start())
    expect(fake.calls.map(c => c.resumeSessionId)).toEqual(['sumiu', undefined])
    expect(emitted.some(e => e.type === 'notice')).toBe(true)
    expect(emitted.at(-1)).toEqual({ type: 'run_finished', status: 'done' })
  })

  it('M3: erro que não é de sessão (limite, rede) não descarta a conversa', async () => {
    const { fake, emitted, svc, start, store, conv } = await setup(async function* () { yield { type: 'error', message: 'rate limit exceeded' } })
    store.createRun({ id: 'antigo', conversationId: conv.id, agentId: 'forja', prompt: 'x', startedAt: 1, hasCheckpoint: true })
    store.finishRun('antigo', 'done', 's1')
    await svc.whenFinished(await start())
    expect(fake.calls).toHaveLength(1)
    expect(emitted.some(e => e.type === 'notice')).toBe(false)
    expect(emitted).toContainEqual({ type: 'error', message: 'rate limit exceeded' })
  })
  it('agente pergunta ao Radar: consulta sem repassar a ferramenta, eventos no run de quem perguntou', async () => {
    let answer = ''
    const { fake, emitted, svc, start } = await setup(async function* (o) {
      if (o.mode === 'consult') { yield { type: 'text', text: `Radar: ${o.prompt}` }; yield { type: 'done' }; return }
      answer = await o.askAgent!('radar', 'qual versão?')
      yield { type: 'done' }
    }, { radar: true })
    await svc.whenFinished(await start())
    const consult = fake.calls.find(c => c.mode === 'consult')!
    expect(consult.agent.id).toBe('radar')
    expect(consult.askAgent).toBeUndefined()
    expect(answer).toContain('qual versão?')
    expect(emitted).toContainEqual({ type: 'agent_call', from: 'forja', to: 'radar', question: 'qual versão?' })
    expect(emitted).toContainEqual({ type: 'agent_call_answer', from: 'forja', to: 'radar', answer })
  })

  it('Radar indisponível: resposta pronta sem chamar adaptador', async () => {
    let answer = ''
    const { fake, svc, start } = await setup(async function* (o) { answer = await o.askAgent!('radar', 'x'); yield { type: 'done' } },
      { toolReady: async t => t !== 'gemini' })
    await svc.whenFinished(await start())
    expect(answer).toBe('O Radar não está disponível.')
    expect(fake.calls.filter(c => c.mode === 'consult')).toEqual([])
  })
  it('uso e limite são gravados e emitidos, mas não entram no histórico do chat', async () => {
    const { emitted, svc, start, store } = await setup(async function* () {
      yield { type: 'usage', tool: 'claude', tokens: { input: 3, output: 2, cacheRead: 0, reasoning: 0 } }
      yield { type: 'limit', limit: { tool: 'claude', window: 'five_hour', utilization: 40, at: 1 } }
      yield { type: 'done' }
    })
    const id = await start()
    await svc.whenFinished(id)
    expect(emitted.some(e => e.type === 'usage') && emitted.some(e => e.type === 'limit')).toBe(true)
    expect(store.listEvents(id).some(e => e.type === 'usage' || e.type === 'limit')).toBe(false)
    expect(store.tokensSince('claude', 0).input).toBe(3)
    expect(store.latestLimits()).toEqual([{ tool: 'claude', window: 'five_hour', utilization: 40, at: 1 }])
  })
  it('contexto compartilhado: outro agente na mesma conversa recebe o que o primeiro disse; conversa nova não', async () => {
    const { fake, svc, store, conv, dir } = await setup(async function* (o) { yield { type: 'text', text: `resposta do ${o.agent.id}` }; yield { type: 'done', sessionId: `s-${o.agent.id}` } })
    await svc.whenFinished(await svc.start({ projectPath: dir, conversationId: conv.id, agentId: 'forja', prompt: 'Qual cor?' }))
    await svc.whenFinished(await svc.start({ projectPath: dir, conversationId: conv.id, agentId: 'pincel', prompt: 'Concorda?' }))
    const second = fake.calls[1].prompt
    expect(second).toContain('Qual cor?')
    expect(second).toContain('resposta do forja')
    expect(second.endsWith('Concorda?')).toBe(true)
    const nova = store.createConversation(store.upsertProject(dir).id, 'n')
    await svc.whenFinished(await svc.start({ projectPath: dir, conversationId: nova.id, agentId: 'pincel', prompt: 'Oi' }))
    expect(fake.calls[2].prompt).toBe('Oi')
  })

  it('agente que retoma a sessão recebe só o que é novo', async () => {
    const { fake, svc, conv, dir } = await setup(async function* (o) { yield { type: 'text', text: `resp ${o.prompt.slice(-4)}` }; yield { type: 'done', sessionId: `s-${o.agent.id}` } })
    const go = async (agentId: 'forja' | 'pincel', prompt: string) => svc.whenFinished(await svc.start({ projectPath: dir, conversationId: conv.id, agentId, prompt }))
    await go('forja', 'pedido AAAA')
    await go('pincel', 'pedido BBBB')
    await go('forja', 'pedido CCCC')
    const third = fake.calls[2]
    expect(third.resumeSessionId).toBe('s-forja')
    expect(third.prompt).toContain('pedido BBBB')
    expect(third.prompt).not.toContain('pedido AAAA')
  })
  it('aviso de limite: um por pedido por ferramenta, mesmo oscilando', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const { emitted, svc, start } = await setup(async function* () { await gate; yield { type: 'done' } })
    const id = await start()
    await new Promise(r => setTimeout(r, 300))
    for (const u of [91, 89, 93]) await svc.warnLimit('claude', 'five_hour', u, async () => 'curinga')
    expect(emitted.filter(e => e.type === 'limit_warning')).toHaveLength(1)
    expect(emitted.find(e => e.type === 'limit_warning')).toMatchObject({ tool: 'claude', window: 'five_hour', utilization: 91, to: 'curinga' })
    release()
    await svc.whenFinished(id)
  })

  it('pedido que termina com aviso pendente fecha o aviso sem passar', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const { emitted, svc, start } = await setup(async function* () { await gate; yield { type: 'done' } })
    const id = await start()
    await new Promise(r => setTimeout(r, 300))
    await svc.warnLimit('claude', 'five_hour', 92, async () => 'curinga')
    const w = emitted.find(e => e.type === 'limit_warning') as Extract<RunEvent, { type: 'limit_warning' }>
    release()
    await svc.whenFinished(id)
    expect(emitted).toContainEqual({ type: 'limit_resolved', id: w.id, pass: false })
  })

  it('I-1: substituto que não consegue começar não deixa o pedido sem resposta', async () => {
    let curingaOk = true
    const { emitted, svc, start, store } = await setup(async function* (o) {
      await new Promise<void>(r => o.signal.addEventListener('abort', () => r(), { once: true }))
    }, { all: true, toolReady: async t => t !== 'opencode' || curingaOk })
    const id = await start()
    await new Promise(r => setTimeout(r, 300))
    await svc.warnLimit('claude', 'five_hour', 95, async () => 'curinga')
    const w = emitted.find(e => e.type === 'limit_warning') as Extract<RunEvent, { type: 'limit_warning' }>
    curingaOk = false
    await expect(svc.respondLimit(w.id, true)).resolves.toBeUndefined()
    expect(store.getRun(id)?.status).toBe('cancelled')
    expect(emitted.some(e => e.type === 'notice' && /Curinga/.test(e.text))).toBe(true)
    expect(emitted.some(e => e.type === 'handoff')).toBe(false)
  })

  it('I-3: sem aviso para pedido que já entregou o resultado', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const { emitted, svc, start } = await setup(async function* () { yield { type: 'done' }; await gate })
    const id = await start()
    await new Promise(r => setTimeout(r, 300))
    await svc.warnLimit('claude', 'five_hour', 95, async () => 'curinga')
    expect(emitted.some(e => e.type === 'limit_warning')).toBe(false)
    release()
    await svc.whenFinished(id)
  })

  it('I-3: pedido que termina enquanto escolhe o substituto não ganha aviso aberto', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const { emitted, svc, start } = await setup(async function* () { await gate; yield { type: 'done' } })
    const id = await start()
    await new Promise(r => setTimeout(r, 300))
    await svc.warnLimit('claude', 'five_hour', 95, async () => { release(); await svc.whenFinished(id); return 'curinga' })
    expect(emitted.some(e => e.type === 'limit_warning')).toBe(false)
  })

  it('sem substituto: aviso sem destino; Passar não faz nada além de fechar o aviso', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const { emitted, svc, start, fake } = await setup(async function* () { await gate; yield { type: 'done' } })
    const id = await start()
    await new Promise(r => setTimeout(r, 300))
    await svc.warnLimit('claude', 'five_hour', 95, async () => undefined)
    const w = emitted.find(e => e.type === 'limit_warning') as Extract<RunEvent, { type: 'limit_warning' }>
    expect(w.to).toBeUndefined()
    await svc.respondLimit(w.id, true)
    expect(emitted).toContainEqual({ type: 'limit_resolved', id: w.id, pass: false })
    expect(fake.calls).toHaveLength(1)
    release()
    await svc.whenFinished(id)
  })

  it('Passar com aprovação pendente: original cancela, Curinga assume com a lista do que mudou', async () => {
    const { emitted, svc, start, fake, store } = await setup(async function* (o) {
      if (o.agent.id === 'curinga') { yield { type: 'done' }; return }
      yield { type: 'file_changed', path: 'src/a.ts' }
      await o.requestApproval({ toolName: 'Bash', summary: 'npm i x' })
    }, { all: true })
    const id = await start('Crie a API')
    await waitFor(() => emitted.some(e => e.type === 'approval_request'))
    await svc.warnLimit('claude', 'five_hour', 92, async () => 'curinga')
    const w = emitted.find(e => e.type === 'limit_warning') as Extract<RunEvent, { type: 'limit_warning' }>
    await svc.respondLimit(w.id, true)
    await svc.whenFinished(id)
    expect(store.getRun(id)!.status).toBe('cancelled')
    expect(emitted).toContainEqual({ type: 'approval_resolved', id: expect.any(String), allowed: false })
    const handoff = emitted.find(e => e.type === 'handoff') as Extract<RunEvent, { type: 'handoff' }>
    expect(handoff.to).toBe('curinga')
    await svc.whenFinished(handoff.newRunId)
    const replacement = fake.calls.find(c => c.agent.id === 'curinga')!
    expect(replacement.prompt).toContain('assumindo o trabalho do Forja')
    expect(replacement.prompt).toContain('src/a.ts')
    expect(replacement.prompt).toContain('Crie a API')
  })

  describe('agentes por perfil (CLI ou API)', () => {
    const perfil = (model: string, transport: Profile['defaults']['transport'] = { kind: 'api', provider: 'openrouter' }): Profile => ({
      id: 'tp', nome: 'Teste', builtin: false, defaults: { transport, model },
      agents: [{ id: 'kimi', nome: 'Kimi', prompt: 'Faz coisas.', funcao: 'Geral', readOnly: false, reviewer: false, consultable: false }],
    })
    const startKimi = (svc: RunService, dir: string, conv: { id: string }, prompt = 'faz') => svc.start({ projectPath: dir, conversationId: conv.id, agentId: 'kimi', prompt })

    it('agente API roda no opencode com provedor/modelo do perfil, ignorando modelo do pedido', async () => {
      registerAgents(resolveAgentDefs(perfil('moonshotai/kimi-k3.1-pro')))
      const { fake, svc, dir, conv } = await setup(async function* () { yield { type: 'done', sessionId: 's1' } }, { all: true, keyReady: () => true })
      await svc.whenFinished(await svc.start({ projectPath: dir, conversationId: conv.id, agentId: 'kimi', prompt: 'faz', model: 'opencode/big-pickle' }))
      expect(fake.calls[0].model).toBe('openrouter/moonshotai/kimi-k3.1-pro')
    })

    it('agente API sem chave: indisponível com dica e o pedido não começa', async () => {
      registerAgents(resolveAgentDefs(perfil('moonshotai/kimi-k3.1-pro')))
      const { svc, dir, conv, fake } = await setup(async function* () { yield { type: 'done' } }, { all: true, keyReady: () => false })
      expect(await svc.availability('kimi')).toEqual({ ok: false, hint: 'Sem chave da OpenRouter' })
      await expect(startKimi(svc, dir, conv)).rejects.toThrow('TOOL_UNAVAILABLE')
      expect(fake.calls).toHaveLength(0)
      expect(await svc.availability('forja')).toEqual({ ok: true })
    })

    it('trocar o modelo do agente começa sessão nova; mesmo modelo retoma', async () => {
      registerAgents(resolveAgentDefs(perfil('moonshotai/kimi-k3.1-pro')))
      const { fake, svc, dir, conv } = await setup(async function* () { yield { type: 'done', sessionId: 's-kimi' } }, { all: true, keyReady: () => true })
      await svc.whenFinished(await startKimi(svc, dir, conv))
      await svc.whenFinished(await startKimi(svc, dir, conv))
      expect(fake.calls[1].resumeSessionId).toBe('s-kimi')
      registerAgents(resolveAgentDefs(perfil('deepseek/deepseek-v4-pro')))
      await svc.whenFinished(await startKimi(svc, dir, conv))
      expect(fake.calls[2].resumeSessionId).toBeUndefined()
    })

    it('trocar o transporte também começa sessão nova', async () => {
      registerAgents(resolveAgentDefs(perfil('claude-sonnet-5-5', { kind: 'cli', tool: 'claude' })))
      const { fake, svc, dir, conv } = await setup(async function* () { yield { type: 'done', sessionId: 's-x' } }, { all: true, keyReady: () => true })
      await svc.whenFinished(await startKimi(svc, dir, conv))
      registerAgents(resolveAgentDefs(perfil('claude-sonnet-5-5', { kind: 'api', provider: 'anthropic' })))
      await svc.whenFinished(await startKimi(svc, dir, conv))
      expect(fake.calls[1].resumeSessionId).toBeUndefined()
    })

    it('uso de agente API vai como fonte "api"', async () => {
      registerAgents(resolveAgentDefs(perfil('moonshotai/kimi-k3.1-pro')))
      const tokens = { input: 10, output: 5, cacheRead: 0, reasoning: 0 }
      const { svc, dir, conv, store, emitted } = await setup(async function* () { yield { type: 'usage', tool: 'opencode', tokens }; yield { type: 'done' } }, { all: true, keyReady: () => true })
      await svc.whenFinished(await startKimi(svc, dir, conv))
      expect(store.tokensSince('api', 0)).toMatchObject({ input: 10, output: 5 })
      expect(store.tokensSince('opencode', 0)).toMatchObject({ input: 0 })
      expect(emitted).toContainEqual({ type: 'usage', tool: 'api', tokens })
    })
  })

  it('substituto pago aparece marcado no aviso', async () => {
    registerAgents(resolveAgentDefs({ id: 'tp2', nome: 'T', builtin: false, defaults: { transport: { kind: 'api', provider: 'openrouter' }, model: 'moonshotai/kimi-k3.1-pro' },
      agents: [{ id: 'kimi2', nome: 'Kimi', prompt: 'x', funcao: 'x', readOnly: false, reviewer: false, consultable: false }] }))
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const { emitted, svc, start } = await setup(async function* () { await gate; yield { type: 'done' } })
    const id = await start()
    await new Promise(r => setTimeout(r, 300))
    await svc.warnLimit('claude', 'five_hour', 95, async () => 'kimi2')
    expect(emitted.find(e => e.type === 'limit_warning')).toMatchObject({ to: 'kimi2', paid: { provider: 'OpenRouter' } })
    release()
    await svc.whenFinished(id)
  })

  it('agente de perfil apagado não recebe pedido', async () => {
    registerAgents([{ ...getAgent('forja'), id: 'velho', nome: 'Velho (removido)', profileId: 'removido:p9' }])
    const { svc } = await setup(async function* () { yield { type: 'done' } })
    expect(await svc.availability('velho')).toEqual({ ok: false, hint: 'Agente removido' })
  })
})

