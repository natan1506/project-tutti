import { randomUUID } from 'node:crypto'
import { AGENTS, getAgent, type AgentId, type ToolKind } from '@shared/agents'
import type { RunEvent, RunStatus } from '@shared/events'
import type { Confirmation, Lineup, Triage } from '@shared/team'
import type { AgentAdapter } from '../adapters/types'
import { isGitRepo } from '../git/git'
import type { RunService } from '../runs/runService'
import type { Store } from '../store/db'
import type { Brain } from './brain'
import { parseConfirmation, parseLineup, parseTriage } from './parse'
import { childPrompt, confirmPrompt } from './prompts'
import { buildWaves, isBig, normalizeAreas } from './schedule'

// Spec §5.2–5.4: um pedido de time é um run-pai do Bússola (ponto de restauração e diff do pedido inteiro)
// com um run-filho por passo da escalação.

export interface TeamStartInput { projectPath: string; conversationId: string; prompt: string; fullRound?: boolean; forcePlan?: boolean }

interface Deps {
  runs: RunService
  store: Store
  brain: Brain
  adapters: Record<ToolKind, AgentAdapter | undefined>
  toolReady(tool: ToolKind): Promise<boolean>
  emit(runId: string, ev: RunEvent): void
  confirmTimeoutMs?: number
}

export const ALLOWED_MODELS: Record<ToolKind, string[]> = {
  claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], codex: [], gemini: [], opencode: ['opencode/big-pickle'],
}
/** Confirmação é uma frase: modelo barato onde há escolha. */
const CHEAP_MODEL: Partial<Record<ToolKind, string>> = { claude: 'claude-haiku-5-5' }
const BRAIN_FAILED = 'O Bússola não conseguiu organizar o time. Tente de novo ou fale direto com um agente.'

/** Espera `p` ou o cancelamento, o que vier primeiro. */
function untilAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T | 'abort'> {
  if (signal.aborted) return Promise.resolve('abort')
  return Promise.race([p, new Promise<'abort'>(r => signal.addEventListener('abort', () => r('abort'), { once: true }))])
}

export class TeamService {
  private plans = new Map<string, (approved: boolean) => void>()
  private finished = new Map<string, Promise<void>>()

  /** Filho trocado por limite → quem assumiu (o pai espera o substituto no lugar). */
  private replaced = new Map<string, Promise<string>>()

  constructor(private deps: Deps) {
    deps.runs.onChildHandoff = (parentId, oldId, newId, to) => {
      this.replaced.set(oldId, newId)
      void newId.then(id => this.say(parentId, { type: 'child_started', runId: id, agentId: to, task: `Assume o trabalho de ${getAgent(this.deps.store.getRun(oldId)!.agentId).nome}` }))
    }
  }

  /** Espera o filho e, se ele foi substituído, o substituto (em cadeia). Devolve o id final. */
  private async settle(id: string, active: Set<string>, signal: AbortSignal): Promise<string> {
    await this.deps.runs.whenFinished(id)
    const pending = this.replaced.get(id)
    if (!pending) return id
    const next = await pending
    this.replaced.delete(id)
    if (next === id) return id
    active.delete(id)
    active.add(next)
    // O pai foi cancelado enquanto a troca acontecia: o substituto não chegou a ver o cancelamento.
    if (signal.aborted) this.deps.runs.cancel(next)
    return this.settle(next, active, signal)
  }

  async start(input: TeamStartInput): Promise<string> {
    if (!(await this.deps.toolReady('claude'))) throw new Error('TOOL_UNAVAILABLE')
    if (!(await isGitRepo(input.projectPath))) throw new Error('NOT_A_GIT_REPO')
    const parentId = this.deps.runs.open({ projectPath: input.projectPath, conversationId: input.conversationId, agentId: 'bussola', prompt: input.prompt }, true)
    this.say(parentId, { type: 'team_started' })
    this.finished.set(parentId, this.lifecycle(parentId, input, this.deps.runs.signalOf(parentId)!))
    return parentId
  }

  whenFinished(parentId: string): Promise<void> {
    return this.finished.get(parentId) ?? this.deps.runs.whenFinished(parentId)
  }

  respondPlan(planId: string, approved: boolean): void {
    this.plans.get(planId)?.(approved)
  }

  cancel(parentId: string): void {
    this.deps.runs.cancel(parentId)
  }

  private say(id: string, ev: RunEvent) { this.deps.runs.record(id, ev) }

  private async lifecycle(parentId: string, input: TeamStartInput, signal: AbortSignal): Promise<void> {
    const { runs } = this.deps
    if (!(await runs.waitTurn(parentId, input.projectPath, signal))) return
    // Cancelar o pai cancela todos os filhos ativos.
    const active = new Set<string>()
    signal.addEventListener('abort', () => { for (const c of active) runs.cancel(c) }, { once: true })
    let status: RunStatus = 'done'
    let checkpoint = false
    try {
      await runs.snapshotBefore(parentId, input.projectPath)
      checkpoint = true
      status = await this.orchestrate(parentId, input, signal, active)
    } catch (e) {
      if (!signal.aborted) {
        status = 'error'
        this.say(parentId, { type: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    } finally {
      // Nenhum filho pode continuar escrevendo depois que o pedido fecha e a fila anda.
      for (const c of active) runs.cancel(c)
      await Promise.all([...active].map(c => runs.whenFinished(c)))
      if (signal.aborted) status = 'cancelled'
      if (checkpoint && !(await runs.finalDiff(parentId, input.projectPath))) status = 'error'
      runs.close(parentId, status)
      runs.queue.release(input.projectPath, parentId)
    }
  }

  private async available(): Promise<AgentId[]> {
    const ready = await Promise.all(AGENTS.map(async a => ((await this.deps.toolReady(a.tool)) && this.deps.adapters[a.tool] ? a.id : null)))
    return ready.filter((x): x is AgentId => !!x)
  }

  /** Chama o Bússola e valida; uma nova tentativa se vier inválido. */
  /** Chama o Bússola e valida; uma nova tentativa só se a resposta veio inválida (falha de chamada não se repete). */
  private async ask<T>(call: () => Promise<unknown>, parse: (raw: unknown) => T | null, signal: AbortSignal): Promise<T | null | 'abort'> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await untilAbort(call().then(raw => ({ raw }), () => null), signal)
      if (res === 'abort') return 'abort'
      if (!res) return null
      const parsed = parse(res.raw)
      if (parsed) return parsed
    }
    return null
  }

  private async orchestrate(parentId: string, input: TeamStartInput, signal: AbortSignal, active: Set<string>): Promise<RunStatus> {
    const { brain, runs, store } = this.deps
    const cwd = input.projectPath
    const available = await this.available()

    const triage = await this.ask<Triage>(() => brain.triage({ cwd, prompt: input.prompt, available, signal }), raw => parseTriage(raw, available), signal)
    if (triage === 'abort') return 'cancelled'
    if (!triage) { this.say(parentId, { type: 'error', message: BRAIN_FAILED }); return 'error' }
    this.say(parentId, { type: 'triage', scores: triage.scores, candidates: triage.candidates })

    const targets = input.fullRound ? available : triage.candidates
    const confirmations = await Promise.all(targets.map(id =>
      this.confirm(id, input.prompt, cwd, triage.scores.find(s => s.agentId === id)?.line ?? '', signal)
        .then(c => { if (!signal.aborted) this.say(parentId, { type: 'confirmation', confirmation: c }); return c })))
    if (signal.aborted) return 'cancelled'
    if (!confirmations.some(c => c.decision === 'assumo' || c.decision === 'assumo_com_ajuda')) {
      this.say(parentId, { type: 'text', text: 'Ninguém do time assumiu esse pedido. Tente reformular ou fale direto com um agente.' })
      return 'done'
    }

    const lineup = await this.ask<Lineup>(() => brain.lineup({ cwd, prompt: input.prompt, triage, confirmations, available, signal }),
      raw => parseLineup(raw, available, ALLOWED_MODELS), signal)
    if (lineup === 'abort') return 'cancelled'
    if (!lineup) { this.say(parentId, { type: 'error', message: BRAIN_FAILED }); return 'error' }
    // Ondas calculadas com áreas normalizadas; o texto original das áreas segue para os agentes.
    const waves = buildWaves(lineup.steps.map(st => ({ ...st, areas: normalizeAreas(st.areas, cwd) })))
    const big = isBig(lineup, !!input.forcePlan)
    this.say(parentId, { type: 'lineup', lineup, waves, big })

    if (big) {
      const approved = await this.waitPlan(parentId, signal)
      if (!approved) {
        if (!signal.aborted) this.say(parentId, { type: 'text', text: 'Plano recusado; nada foi alterado.' })
        return 'cancelled'
      }
    }

    for (const wave of waves) {
      if (signal.aborted) return 'cancelled'
      const started = await Promise.allSettled(wave.map(async i => {
        const step = lineup.steps[i]
        const others = wave.filter(j => j !== i).map(j => lineup.steps[j])
        const id = await runs.startChild({
          projectPath: cwd, conversationId: input.conversationId, agentId: step.agentId, parentRunId: parentId,
          prompt: childPrompt(step, input.prompt, others), ...(step.model ? { model: step.model } : {}),
        })
        active.add(id)
        if (signal.aborted) runs.cancel(id)
        this.say(parentId, { type: 'child_started', runId: id, agentId: step.agentId, task: step.task })
        return id
      }))
      const ids = started.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))
      const notStarted = wave.filter((_, k) => started[k].status === 'rejected').map(i => lineup.steps[i].agentId)
      if (notStarted.length) {
        // Um passo não começou: os irmãos já iniciados param (o pedido fecha inteiro, sem ninguém escrevendo sozinho).
        for (const id of ids) runs.cancel(id)
        await Promise.all(ids.map(id => runs.whenFinished(id)))
        ids.forEach(id => active.delete(id))
        this.say(parentId, { type: 'error', message: `Não consegui iniciar ${notStarted.map(a => `o ${getAgent(a).nome}`).join(' e ')}: a ferramenta não está pronta.` })
        return 'error'
      }
      const finals = await Promise.all(ids.map(id => this.settle(id, active, signal)))
      finals.forEach(id => active.delete(id))
      if (signal.aborted) return 'cancelled'
      const results = finals.map(id => store.getRun(id))
      const failed = results.find(r => r?.status === 'error')
      if (failed) {
        this.say(parentId, { type: 'text', text: `Parei porque o ${getAgent(failed.agentId).nome} falhou.` })
        return 'error'
      }
      const cancelled = results.find(r => r?.status === 'cancelled')
      if (cancelled) {
        this.say(parentId, { type: 'text', text: `Parei porque o passo do ${getAgent(cancelled.agentId).nome} foi cancelado.` })
        return 'cancelled'
      }
    }
    return 'done'
  }

  private waitPlan(parentId: string, signal: AbortSignal): Promise<boolean> {
    const id = randomUUID()
    this.say(parentId, { type: 'plan_request', id })
    return new Promise<boolean>(resolve => {
      const done = (approved: boolean) => {
        if (!this.plans.has(id)) return
        this.plans.delete(id)
        this.say(parentId, { type: 'plan_resolved', id, approved })
        resolve(approved)
      }
      this.plans.set(id, done)
      if (signal.aborted) done(false)
      else signal.addEventListener('abort', () => done(false), { once: true })
    })
  }

  /** Confirmação real do candidato na própria ferramenta, em modo consulta, com prazo. */
  private async confirm(agentId: AgentId, prompt: string, cwd: string, line: string, parent: AbortSignal): Promise<Confirmation> {
    const agent = getAgent(agentId)
    const adapter = this.deps.adapters[agent.tool]
    const silent: Confirmation = { agentId, decision: 'sem_resposta', line: '' }
    if (!adapter || !(await this.deps.toolReady(agent.tool))) return silent
    const ctl = new AbortController()
    const onParent = () => ctl.abort()
    parent.addEventListener('abort', onParent, { once: true })
    const timer = setTimeout(() => ctl.abort(), this.deps.confirmTimeoutMs ?? 60_000)
    let text = ''
    try {
      for await (const ev of adapter.run({
        agent, cwd, instructions: '', prompt: confirmPrompt(agentId, prompt, line), signal: ctl.signal, mode: 'consult',
        ...(CHEAP_MODEL[agent.tool] ? { model: CHEAP_MODEL[agent.tool] } : {}), requestApproval: async () => false,
      })) {
        if (ev.type === 'text') text += (text ? '\n' : '') + ev.text
        if (ctl.signal.aborted) break
      }
    } catch {
      return silent
    } finally {
      clearTimeout(timer)
      parent.removeEventListener('abort', onParent)
    }
    return ctl.signal.aborted && !text ? silent : parseConfirmation(agentId, text)
  }
}
