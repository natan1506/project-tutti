import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerAgents, type AgentId, type ToolKind } from '@shared/agents'
import type { AutonomyLevel } from '@shared/autonomy'
import type { AgentEvent, RunEvent } from '@shared/events'
import { resolveAgentDefs, TRABALHO_SEED, type Profile } from '@shared/profiles'
import type { AdapterRunOptions, AgentAdapter } from '../../../src/main/adapters/types'
import { runGit } from '../../../src/main/git/git'
import { RunService } from '../../../src/main/runs/runService'
import { openStore } from '../../../src/main/store/db'
import type { Brain } from '../../../src/main/team/brain'
import { brainOut, pickForRole } from '../../../src/main/team/esteira'
import { TeamService } from '../../../src/main/team/teamService'

// Perfil Trabalho com ids próprios (os do seed colidem com os do Padrão no registro de agentes).
const ID: Record<string, string> = { bussola: 'tb', forja: 'tf', lupa: 'tl', curinga: 'tc', radar: 'tr' }
const PROFILE: Profile = {
  ...TRABALHO_SEED, id: 'trab', coordinatorId: 'tb',
  agents: TRABALHO_SEED.agents.map(a => ({ ...a, id: ID[a.id] })),
  esteira: { cerebro: 'tb', executor: 'tf', tester: 'tl', reserva: 'tc', maxVoltas: 2 },
}
registerAgents(resolveAgentDefs(PROFILE))

type Review = { pronto: boolean; falta: string }
function fakeBrain(reviews: Review[] = [{ pronto: true, falta: '' }]) {
  const b = {
    plans: [] as (string | undefined)[], reviewCalls: 0,
    async triage() { throw new Error('esteira não faz triagem') },
    async lineup() { throw new Error('esteira não faz escalação') },
    instructions: [] as (string | undefined)[],
    async plan(i: { feedback?: string; instructions?: string }) { b.plans.push(i.feedback); b.instructions.push(i.instructions); return { tarefa: 'Criar soma.js', pronto: 'teste de soma passa' } },
    async review() { return reviews[Math.min(b.reviewCalls++, reviews.length - 1)] },
  }
  return b as typeof b & Brain
}

class Fake implements AgentAdapter {
  calls: AdapterRunOptions[] = []
  constructor(private fail: Set<string>) {}
  async *run(o: AdapterRunOptions): AsyncGenerator<AgentEvent> {
    this.calls.push(o)
    if (this.fail.has(o.agent.id)) { yield { type: 'error', message: 'quebrou' }; return }
    if (o.agent.id === 'tf' || o.agent.id === 'tc') {
      mkdirSync(o.cwd, { recursive: true })
      writeFileSync(join(o.cwd, 'soma.js'), `// ${this.calls.length}\n`)
      yield { type: 'text', text: 'Fiz soma.js.' }
    } else yield { type: 'text', text: 'Teste passou.' }
    yield { type: 'done' }
  }
}

async function setup(o: { brain?: ReturnType<typeof fakeBrain>; ready?: (t: ToolKind) => boolean; fail?: string[]; autonomy?: AutonomyLevel; git?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'esteira-'))
  if (o.git !== false) { await runGit(dir, ['init', '-q']); writeFileSync(join(dir, 'README.md'), 'x\n') }
  const store = openStore(':memory:')
  const conv = store.createConversation(store.upsertProject(dir).id, 't')
  const emitted: { runId: string; ev: RunEvent }[] = []
  const emit = (runId: string, ev: RunEvent) => emitted.push({ runId, ev })
  const fake = new Fake(new Set(o.fail ?? []))
  const adapters = { claude: fake, codex: fake, gemini: fake, opencode: fake }
  const toolReady = async (t: ToolKind) => o.ready?.(t) ?? true
  const runs = new RunService({ store, adapters, emit, homeDir: mkdtempSync(join(tmpdir(), 'h-')), toolReady, autonomyFor: () => o.autonomy ?? 'autonomous' })
  const brain = o.brain ?? fakeBrain()
  const team = new TeamService({ runs, store, brain, adapters, toolReady, emit, profileOf: () => PROFILE, brainFor: () => brain })
  const start = () => team.start({ projectPath: dir, conversationId: conv.id, prompt: 'crie soma(a,b) com teste', profileId: 'trab' })
  const events = (id: string) => emitted.filter(e => e.runId === id).map(e => e.ev)
  const childAgents = (id: string) => store.listChildren(id).map(r => r.agentId)
  return { dir, store, fake, runs, team, start, events, childAgents, brain, emitted }
}

const kinds = (evs: RunEvent[]) => evs.map(e => e.type).filter(t => t !== 'queued')

describe('esteira', () => {
  it('caminho feliz: plano → executor → tester → revisão pronta', async () => {
    const t = await setup()
    const id = await t.start()
    await t.team.whenFinished(id)
    const evs = t.events(id)
    expect(kinds(evs)).toEqual(['run_started', 'team_started', 'esteira_plan', 'child_started', 'child_started', 'esteira_review', 'diff', 'run_finished'])
    expect(evs.find(e => e.type === 'esteira_plan')).toMatchObject({ plan: { tarefa: 'Criar soma.js', pronto: 'teste de soma passa' }, volta: 0 })
    expect(evs.at(-1)).toEqual({ type: 'run_finished', status: 'done' })
    expect(t.childAgents(id)).toEqual(['tf', 'tl'])
    const work = t.fake.calls.filter(c => c.mode !== 'consult')
    expect(work.every(c => c.write === true)).toBe(true)
    expect(work[1].prompt).toContain('Fiz soma.js.')
  })

  it('o cérebro recebe as instruções do projeto (CLAUDE.md)', async () => {
    const t = await setup()
    writeFileSync(join(t.dir, 'CLAUDE.md'), 'Regra do repo: use pnpm.')
    await t.team.whenFinished(await t.start())
    expect(t.brain.instructions[0]).toContain('Regra do repo: use pnpm.')
  })

  it('revisão pede mais: volta ao executor com o que falta', async () => {
    const brain = fakeBrain([{ pronto: false, falta: 'faltou o teste de números negativos' }, { pronto: true, falta: '' }])
    const t = await setup({ brain })
    const id = await t.start()
    await t.team.whenFinished(id)
    expect(t.childAgents(id)).toEqual(['tf', 'tl', 'tf', 'tl'])
    const executorCalls = t.fake.calls.filter(c => c.agent.id === 'tf')
    expect(executorCalls[1].prompt).toContain('faltou o teste de números negativos')
    expect(t.events(id).at(-1)).toEqual({ type: 'run_finished', status: 'done' })
  })

  it('passa de 2 voltas: para e diz o que falta', async () => {
    const t = await setup({ brain: fakeBrain([{ pronto: false, falta: 'X' }]) })
    const id = await t.start()
    await t.team.whenFinished(id)
    expect(t.childAgents(id)).toHaveLength(6)
    expect(t.events(id)).toContainEqual({ type: 'text', text: 'Parei depois de 2 voltas. Falta: X' })
    expect(t.events(id).at(-1)).toEqual({ type: 'run_finished', status: 'error' })
  })

  it('executor indisponível: reserva assume e avisa', async () => {
    const t = await setup({ ready: tool => tool !== 'codex' })
    const id = await t.start()
    await t.team.whenFinished(id)
    expect(t.events(id)).toContainEqual(expect.objectContaining({ type: 'esteira_swap', role: 'executor', from: 'tf', to: 'tc' }))
    expect(t.childAgents(id)[0]).toBe('tc')
    expect(t.events(id).at(-1)).toEqual({ type: 'run_finished', status: 'done' })
  })

  it('executor e reserva indisponíveis: erro claro, tester não roda', async () => {
    const t = await setup({ ready: tool => tool === 'claude' })
    const id = await t.start()
    await t.team.whenFinished(id)
    expect(t.events(id)).toContainEqual({ type: 'error', message: 'Ninguém disponível para executar: Forja e Curinga estão indisponíveis.' })
    expect(t.childAgents(id)).toEqual([])
    expect(t.events(id).at(-1)).toEqual({ type: 'run_finished', status: 'error' })
  })

  it('executor falha: não chama o tester', async () => {
    const t = await setup({ fail: ['tf'] })
    const id = await t.start()
    await t.team.whenFinished(id)
    expect(t.childAgents(id)).toEqual(['tf'])
    expect(t.events(id)).toContainEqual({ type: 'text', text: 'Parei porque o Forja falhou.' })
    expect(t.events(id).at(-1)).toEqual({ type: 'run_finished', status: 'error' })
  })

  it('cérebro sem limite: para antes de chamar o executor', async () => {
    const t = await setup()
    const segunda = new Date(2026, 10, 16, 9, 0).getTime()
    t.store.recordLimit({ tool: 'claude', window: 'seven_day', utilization: 100, resetsAt: segunda, at: Date.now() })
    const id = await t.start()
    await t.team.whenFinished(id)
    const msg = t.events(id).find(e => e.type === 'error') as { message: string }
    expect(msg.message).toMatch(/^Bússola \(Claude\) sem limite até .+ — o time parou$/)
    expect(t.childAgents(id)).toEqual([])
    expect(t.brain.plans).toEqual([])
  })

  it('autonomia pede aprovação: espera o plano; recusado não chama ninguém', async () => {
    const t = await setup({ autonomy: 'accept_edits' })
    const id = await t.start()
    for (let i = 0; i < 200 && !t.events(id).some(e => e.type === 'plan_request'); i++) await new Promise(r => setTimeout(r, 10))
    const req = t.events(id).find(e => e.type === 'plan_request') as { id: string }
    expect(t.childAgents(id)).toEqual([])
    t.team.respondPlan(req.id, false)
    await t.team.whenFinished(id)
    expect(t.childAgents(id)).toEqual([])
    expect(t.events(id)).toContainEqual({ type: 'text', text: 'Plano recusado; nada foi alterado.' })
    expect(t.events(id).at(-1)).toEqual({ type: 'run_finished', status: 'cancelled' })
  })

  it('pasta sem git: esteira roda sem diff', async () => {
    const t = await setup({ git: false })
    const id = await t.start()
    await t.team.whenFinished(id)
    expect(kinds(t.events(id))).not.toContain('diff')
    expect(t.events(id).at(-1)).toEqual({ type: 'run_finished', status: 'done' })
  })
})

describe('peças da esteira', () => {
  const now = new Date(2026, 10, 9, 10, 0).getTime()
  it('brainOut: qualquer janela em 100% ainda não renovada', () => {
    expect(brainOut([], 'claude', now)).toEqual({ out: false })
    expect(brainOut([{ tool: 'claude', window: 'five_hour', utilization: 99, at: now }], 'claude', now)).toEqual({ out: false })
    expect(brainOut([{ tool: 'claude', window: 'five_hour', utilization: 100, resetsAt: now + 1000, at: now }], 'claude', now)).toEqual({ out: true, until: now + 1000 })
    expect(brainOut([{ tool: 'claude', window: 'five_hour', utilization: 100, resetsAt: now - 1, at: now - 5000 }], 'claude', now)).toEqual({ out: false })
    expect(brainOut([{ tool: 'codex', window: 'five_hour', utilization: 100, at: now }], 'claude', now)).toEqual({ out: false })
  })
  it('pickForRole: papel pronto fica; senão a reserva; senão ninguém', () => {
    const e = PROFILE.esteira!
    expect(pickForRole('executor', e, () => true)).toEqual({ id: 'tf' })
    expect(pickForRole('tester', e, id => id !== 'tl')).toEqual({ id: 'tc', swappedFrom: 'tl' })
    expect(pickForRole('executor', e, id => id === 'tb')).toBeNull()
  })
})

export type { AgentId }
