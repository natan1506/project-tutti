import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentId, ToolKind } from '@shared/agents'
import type { AgentEvent, RunEvent } from '@shared/events'
import type { AdapterRunOptions, AgentAdapter } from '../../../src/main/adapters/types'
import { runGit } from '../../../src/main/git/git'
import { RunService } from '../../../src/main/runs/runService'
import { openStore } from '../../../src/main/store/db'
import type { Brain } from '../../../src/main/team/brain'
import { TeamService } from '../../../src/main/team/teamService'

type Behaviour = (o: AdapterRunOptions) => AsyncGenerator<AgentEvent>
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const waitFor = async (cond: () => boolean, ms = 3000) => { for (let i = 0; i < ms / 10 && !cond(); i++) await sleep(10) }

/** Adaptador falso: em consulta responde a confirmação do agente; em trabalho segue o roteiro do teste. */
class Fake implements AgentAdapter {
  calls: AdapterRunOptions[] = []
  constructor(private confirm: (id: AgentId) => string | null, private work: Behaviour) {}
  async *run(o: AdapterRunOptions): AsyncGenerator<AgentEvent> {
    this.calls.push(o)
    if (o.mode === 'consult') {
      const reply = this.confirm(o.agent.id)
      if (reply === null) { await new Promise<void>(r => o.signal.addEventListener('abort', () => r(), { once: true })); return }
      yield { type: 'text', text: reply }
      yield { type: 'done' }
      return
    }
    yield* this.work(o)
  }
}

const TRIAGE = {
  scores: [
    { agentId: 'forja', score: 93, line: 'Endpoint é comigo.' }, { agentId: 'pincel', score: 76, line: 'A tela é minha.' },
    { agentId: 'bussola', score: 40, line: 'Coordeno.' }, { agentId: 'lupa', score: 30, line: 'Reviso depois.' },
    { agentId: 'radar', score: 10, line: 'Sem pesquisa.' }, { agentId: 'curinga', score: 5, line: 'Passo.' },
  ],
  candidates: ['forja', 'pincel'], big: false,
}
const LINEUP = {
  summary: 'Forja faz o endpoint, Pincel a página.', big: false,
  steps: [{ agentId: 'forja', task: 'Criar server/health.js', areas: ['server'] }, { agentId: 'pincel', task: 'Criar web/status.html', areas: ['web'] }],
}

function fakeBrain(triages: unknown[], lineups: unknown[] = [LINEUP]): Brain & { triageCalls: number; lineupCalls: number } {
  const b = {
    triageCalls: 0, lineupCalls: 0,
    async triage() { return triages[Math.min(b.triageCalls++, triages.length - 1)] },
    async lineup() { return lineups[Math.min(b.lineupCalls++, lineups.length - 1)] },
  }
  return b
}

async function setup(opts: {
  brain?: Brain; confirm?: (id: AgentId) => string | null; work?: Behaviour; ready?: (t: ToolKind) => boolean; confirmTimeoutMs?: number
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'team-'))
  await runGit(dir, ['init', '-q'])
  writeFileSync(join(dir, 'README.md'), 'x\n')
  const store = openStore(':memory:')
  const conv = store.createConversation(store.upsertProject(dir).id, 't')
  const emitted: { runId: string; ev: RunEvent }[] = []
  const emit = (runId: string, ev: RunEvent) => emitted.push({ runId, ev })
  const working: AgentId[] = []
  const work: Behaviour = opts.work ?? (async function* (o) {
    working.push(o.agent.id)
    const file = o.agent.id === 'forja' ? 'server/health.js' : 'web/status.html'
    mkdirSync(join(o.cwd, file.split('/')[0]), { recursive: true })
    await sleep(80)
    writeFileSync(join(o.cwd, file), 'ok\n')
    yield { type: 'done' }
  })
  const fake = new Fake(opts.confirm ?? (id => `{"decision":"assumo","line":"Assumo, ${id}."}`), work)
  const adapters = { claude: fake, codex: fake, gemini: fake, opencode: fake }
  const toolReady = async (t: ToolKind) => opts.ready?.(t) ?? true
  const runs = new RunService({ store, adapters, emit, homeDir: mkdtempSync(join(tmpdir(), 'h-')), toolReady })
  const brain = opts.brain ?? fakeBrain([TRIAGE])
  const team = new TeamService({ runs, store, brain, adapters, toolReady, emit, confirmTimeoutMs: opts.confirmTimeoutMs ?? 2000 })
  const start = (o: Partial<{ fullRound: boolean; forcePlan: boolean; prompt: string }> = {}) =>
    team.start({ projectPath: dir, conversationId: conv.id, prompt: o.prompt ?? 'Crie /health e a página de status', ...o })
  const parentEvents = (id: string) => emitted.filter(e => e.runId === id).map(e => e.ev)
  return { dir, store, conv, emitted, fake, runs, team, start, parentEvents, working, brain }
}

describe('TeamService', () => {
  it('caminho feliz: triagem → confirmação → escalação → uma onda em paralelo → diff', async () => {
    const t = await setup()
    const id = await t.start()
    await t.team.whenFinished(id)
    const evs = t.parentEvents(id)
    expect(evs.map(e => e.type)).toEqual(['run_started', 'team_started', 'triage', 'confirmation', 'confirmation', 'lineup', 'child_started', 'child_started', 'diff', 'run_finished'])
    expect(evs.find(e => e.type === 'lineup')).toMatchObject({ waves: [[0, 1]], big: false })
    expect(evs.find(e => e.type === 'diff')).toMatchObject({ files: [{ path: 'server/health.js' }, { path: 'web/status.html' }] })
    expect(evs.at(-1)).toEqual({ type: 'run_finished', status: 'done' })
    expect(existsSync(join(t.dir, 'server/health.js')) && existsSync(join(t.dir, 'web/status.html'))).toBe(true)
    expect(t.store.listChildren(id).map(r => r.agentId)).toEqual(['forja', 'pincel'])
  })

  it('os dois filhos da mesma onda começam antes de qualquer um terminar', async () => {
    const t = await setup()
    const id = await t.start()
    await waitFor(() => t.working.length === 2)
    const children = t.store.listChildren(id)
    expect(children.every(c => c.status === 'running')).toBe(true)
    await t.team.whenFinished(id)
  })

  it('confirmação em consulta, modelo barato, só candidatos; rodada completa consulta os seis', async () => {
    const t = await setup()
    await t.team.whenFinished(await t.start())
    const consults = t.fake.calls.filter(c => c.mode === 'consult')
    expect(consults.map(c => c.agent.id).sort()).toEqual(['forja', 'pincel'])
    expect(consults.every(c => c.model === 'claude-haiku-5-5')).toBe(true)
    const t2 = await setup()
    await t2.team.whenFinished(await t2.start({ fullRound: true }))
    expect(t2.fake.calls.filter(c => c.mode === 'consult').map(c => c.agent.id).sort()).toEqual(['bussola', 'curinga', 'forja', 'lupa', 'pincel', 'radar'])
  })

  it('Bússola devolve lixo duas vezes: erro claro, nenhum filho, nada no disco', async () => {
    const t = await setup({ brain: fakeBrain(['lixo', { scores: [] }]) })
    const id = await t.start()
    await t.team.whenFinished(id)
    const evs = t.parentEvents(id)
    expect(evs).toContainEqual({ type: 'error', message: 'O Bússola não conseguiu organizar o time. Tente de novo ou fale direto com um agente.' })
    expect(t.store.listChildren(id)).toEqual([])
    expect(evs.at(-1)).toEqual({ type: 'run_finished', status: 'error' })
    expect(evs.find(e => e.type === 'diff')).toMatchObject({ files: [] })
  })

  it('lixo uma vez e válido na segunda: segue', async () => {
    const brain = fakeBrain(['lixo', TRIAGE])
    const t = await setup({ brain })
    await t.team.whenFinished(await t.start())
    expect(brain.triageCalls).toBe(2)
    expect(t.working.sort()).toEqual(['forja', 'pincel'])
  })

  it('candidato que não responde vira sem_resposta após o prazo; indisponível nem é chamado', async () => {
    const t = await setup({ confirm: id => (id === 'pincel' ? null : '{"decision":"assumo","line":"ok"}'), confirmTimeoutMs: 30 })
    const id = await t.start()
    await t.team.whenFinished(id)
    expect(t.parentEvents(id)).toContainEqual({ type: 'confirmation', confirmation: { agentId: 'pincel', decision: 'sem_resposta', line: '' } })
    const t3 = await setup({ brain: fakeBrain([{ ...TRIAGE, candidates: ['forja', 'radar'] }]), ready: tool => tool !== 'gemini' })
    const id3 = await t3.start()
    await t3.team.whenFinished(id3)
    expect(t3.fake.calls.some(c => c.agent.id === 'radar')).toBe(false)
  })

  it('ninguém assume: Bússola explica e termina sem filhos', async () => {
    const t = await setup({ confirm: () => '{"decision":"nao_e_comigo","line":"Não é comigo."}' })
    const id = await t.start()
    await t.team.whenFinished(id)
    const evs = t.parentEvents(id)
    expect(evs.some(e => e.type === 'text' && /ninguém do time assumiu/i.test(e.text))).toBe(true)
    expect(t.store.listChildren(id)).toEqual([])
    expect(evs.at(-1)).toEqual({ type: 'run_finished', status: 'done' })
  })

  it('pedido grande espera o plano; aprovado executa', async () => {
    const t = await setup()
    const id = await t.start({ forcePlan: true })
    await waitFor(() => t.parentEvents(id).some(e => e.type === 'plan_request'))
    expect(t.working).toEqual([])
    const req = t.parentEvents(id).find(e => e.type === 'plan_request') as Extract<RunEvent, { type: 'plan_request' }>
    t.team.respondPlan(req.id, true)
    await t.team.whenFinished(id)
    expect(t.working.sort()).toEqual(['forja', 'pincel'])
    expect(t.parentEvents(id)).toContainEqual({ type: 'plan_resolved', id: req.id, approved: true })
  })

  it('plano recusado: nenhum filho, nada no disco, cancelled', async () => {
    const t = await setup()
    const id = await t.start({ forcePlan: true })
    await waitFor(() => t.parentEvents(id).some(e => e.type === 'plan_request'))
    const req = t.parentEvents(id).find(e => e.type === 'plan_request') as Extract<RunEvent, { type: 'plan_request' }>
    t.team.respondPlan(req.id, false)
    await t.team.whenFinished(id)
    expect(t.store.listChildren(id)).toEqual([])
    expect(existsSync(join(t.dir, 'server'))).toBe(false)
    expect(t.parentEvents(id).at(-1)).toEqual({ type: 'run_finished', status: 'cancelled' })
  })

  it.each(['triagem', 'plano', 'onda'] as const)('cancelar durante %s fecha tudo e a fila anda', async quando => {
    let releaseTriage: (() => void) | undefined
    let triageCalls = 0
    const slowBrain: Brain = {
      // Só a primeira triagem fica presa; a do pedido seguinte responde na hora.
      triage: () => (triageCalls++ === 0 ? new Promise(r => { releaseTriage = () => r(TRIAGE) }) : Promise.resolve(TRIAGE)),
      lineup: async () => LINEUP,
    }
    const t = await setup({ brain: quando === 'triagem' ? slowBrain : undefined, work: async function* (o) {
      await new Promise<void>(r => o.signal.addEventListener('abort', () => r(), { once: true }))
    } })
    const id = await t.start({ forcePlan: quando === 'plano' })
    if (quando === 'triagem') await sleep(30)
    if (quando === 'plano') await waitFor(() => t.parentEvents(id).some(e => e.type === 'plan_request'))
    if (quando === 'onda') await waitFor(() => t.store.listChildren(id).length === 2)
    const next = await t.start({ prompt: 'segundo' })
    await waitFor(() => t.parentEvents(next).some(e => e.type === 'queued'))
    t.team.cancel(id)
    releaseTriage?.()
    await t.team.whenFinished(id)
    expect(t.parentEvents(id).at(-1)).toEqual({ type: 'run_finished', status: 'cancelled' })
    expect(t.parentEvents(id).some(e => e.type === 'diff')).toBe(true)
    expect(t.store.listChildren(id).every(c => c.status === 'cancelled')).toBe(true)
    await waitFor(() => t.parentEvents(next).some(e => e.type === 'triage'))
    expect(t.parentEvents(next).some(e => e.type === 'triage')).toBe(true)
    t.team.cancel(next)
    await t.team.whenFinished(next)
  })

  it('filho que falha na primeira onda impede a segunda', async () => {
    const lineup = { ...LINEUP, steps: [{ agentId: 'forja', task: 'a', areas: ['server'] }, { agentId: 'pincel', task: 'b', areas: ['server/x'] }] }
    const t = await setup({ brain: fakeBrain([TRIAGE], [lineup]), work: async function* (o) {
      if (o.agent.id === 'forja') { yield { type: 'error', message: 'quebrou' }; return }
      yield { type: 'done' }
    } })
    const id = await t.start()
    await t.team.whenFinished(id)
    expect(t.store.listChildren(id).map(c => c.agentId)).toEqual(['forja'])
    const evs = t.parentEvents(id)
    expect(evs.some(e => e.type === 'text' && e.text === 'Parei porque o Forja falhou.')).toBe(true)
    expect(evs.at(-1)).toEqual({ type: 'run_finished', status: 'error' })
  })
  it('I-1: falha ao iniciar um filho da onda cancela e espera os irmãos antes de fechar e liberar a fila', async () => {
    const t = await setup({ work: async function* (o) { await new Promise<void>(r => o.signal.addEventListener('abort', () => r(), { once: true })) } })
    const realStart = t.runs.startChild.bind(t.runs)
    t.runs.startChild = async input => { if (input.agentId === 'pincel') throw new Error('TOOL_UNAVAILABLE'); return realStart(input) }
    const id = await t.start()
    await t.team.whenFinished(id)
    const kids = t.store.listChildren(id)
    expect(kids.map(k => k.agentId)).toEqual(['forja'])
    expect(kids[0].status).toBe('cancelled')
    const evs = t.parentEvents(id)
    expect(evs.some(e => e.type === 'error' && /Pincel/.test(e.message) && !/TOOL_UNAVAILABLE/.test(e.message))).toBe(true)
    expect(evs.at(-1)).toEqual({ type: 'run_finished', status: 'error' })
  })

  it('M-2: filho cancelado pelo Natan para o time (sem próxima onda)', async () => {
    const lineup = { ...LINEUP, steps: [{ agentId: 'forja', task: 'a', areas: ['server'] }, { agentId: 'lupa', task: 'revisar', areas: [] }] }
    const t = await setup({ brain: fakeBrain([TRIAGE], [lineup]), work: async function* (o) {
      await new Promise<void>(r => o.signal.addEventListener('abort', () => r(), { once: true }))
    } })
    const id = await t.start()
    await waitFor(() => t.store.listChildren(id).length === 1)
    t.runs.cancel(t.store.listChildren(id)[0].id)
    await t.team.whenFinished(id)
    expect(t.store.listChildren(id).map(k => k.agentId)).toEqual(['forja'])
    expect(t.parentEvents(id).at(-1)).toEqual({ type: 'run_finished', status: 'cancelled' })
  })

  it('M-6: Bússola que falha (exceção) não é chamado de novo; resposta inválida é', async () => {
    let calls = 0
    const t = await setup({ brain: { triage: async () => { calls++; throw new Error('rate limit') }, lineup: async () => LINEUP } })
    await t.team.whenFinished(await t.start())
    expect(calls).toBe(1)
  })

  it('I-2: pedido de time emite a vez quando sai da fila', async () => {
    const t = await setup({ work: async function* (o) { await new Promise<void>(r => o.signal.addEventListener('abort', () => r(), { once: true })) } })
    const first = await t.start()
    const second = await t.start({ prompt: 'dois' })
    await waitFor(() => t.parentEvents(second).some(e => e.type === 'queued'))
    t.team.cancel(first)
    await waitFor(() => t.parentEvents(second).some(e => e.type === 'triage'))
    const evs = t.parentEvents(second)
    expect(evs.findIndex(e => e.type === 'queued' && e.position === 0)).toBeGreaterThan(evs.findIndex(e => e.type === 'queued' && e.position === 1))
    t.team.cancel(second)
    await t.team.whenFinished(second)
  })
  it('troca por limite dentro do time: o mesmo passo vira um novo filho do mesmo pedido', async () => {
    const lineup = { ...LINEUP, steps: [{ agentId: 'forja', task: 'Criar server/x.js', areas: ['server'] }] }
    const t = await setup({ brain: fakeBrain([TRIAGE], [lineup]), work: async function* (o) {
      if (o.agent.id === 'curinga') { mkdirSync(join(o.cwd, 'server'), { recursive: true }); writeFileSync(join(o.cwd, 'server/x.js'), 'ok\n'); yield { type: 'done' }; return }
      await new Promise<void>(r => o.signal.addEventListener('abort', () => r(), { once: true }))
    } })
    const id = await t.start()
    await waitFor(() => t.store.listChildren(id).length === 1)
    await t.runs.warnLimit('claude', 'five_hour', 95, async () => 'curinga')
    const w = t.emitted.map(e => e.ev).find(e => e.type === 'limit_warning') as Extract<RunEvent, { type: 'limit_warning' }>
    await t.runs.respondLimit(w.id, true)
    await t.team.whenFinished(id)
    expect(t.store.listChildren(id).map(c => [c.agentId, c.status])).toEqual([['forja', 'cancelled'], ['curinga', 'done']])
    expect(t.parentEvents(id).at(-1)).toEqual({ type: 'run_finished', status: 'done' })
    expect(t.parentEvents(id).find(e => e.type === 'diff')).toMatchObject({ files: [{ path: 'server/x.js' }] })
  })
})
