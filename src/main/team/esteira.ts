import { homedir } from 'node:os'
import { getAgent, type AgentId, type ToolKind } from '@shared/agents'
import type { AutonomyLevel } from '@shared/autonomy'
import type { RunEvent, RunStatus } from '@shared/events'
import type { Esteira, Profile } from '@shared/profiles'
import type { EsteiraPlan, EsteiraReview } from '@shared/team'
import type { LimitWindow } from '@shared/usage'
import { loadInstructions } from '../instructions/loadInstructions'
import { loadProjectMemory } from '../instructions/userContext'
import type { RunService } from '../runs/runService'
import type { Store } from '../store/db'
import type { Brain, UsageSink } from './brain'
import { parseEsteiraPlan, parseEsteiraReview } from './parse'
import { executorPrompt, testerPrompt } from './prompts'
import type { TeamStartInput } from './teamService'

// Esteira (spec tutti-terminal §3): cérebro → executor → tester → cérebro, com no máximo `maxVoltas` devoluções.
// Nesta entrega o cérebro só troca de agente por disponibilidade (fora do ar, sem login, esgotado).

const TOOL_NAME: Record<ToolKind, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Antigravity', opencode: 'opencode' }
const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** "seg 09h" / "seg 09h30". */
export function quando(ts: number): string {
  const d = new Date(ts)
  const mm = d.getMinutes()
  return `${DAYS[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}h${mm ? String(mm).padStart(2, '0') : ''}`
}

/** O cérebro está sem limite? Qualquer janela da ferramenta em 100% que ainda não renovou. */
export function brainOut(limits: LimitWindow[], tool: ToolKind, now: number): { out: false } | { out: true; until?: number } {
  const hit = limits.filter(l => l.tool === tool && l.utilization >= 100 && (l.resetsAt === undefined || l.resetsAt > now))
  if (!hit.length) return { out: false }
  const until = Math.max(...hit.map(l => l.resetsAt ?? 0))
  return until > 0 ? { out: true, until } : { out: true }
}

/** Quem faz o papel agora: o titular se pronto; senão a reserva; senão ninguém. */
export function pickForRole(role: 'executor' | 'tester', e: Esteira, ready: (id: string) => boolean): { id: string; swappedFrom?: string } | null {
  const titular = e[role]
  if (ready(titular)) return { id: titular }
  if (e.reserva && ready(e.reserva)) return { id: e.reserva, swappedFrom: titular }
  return null
}

export interface EsteiraCtx {
  parentId: string
  input: TeamStartInput
  profile: Profile
  signal: AbortSignal
  active: Set<string>
  runs: RunService
  store: Store
  brain: Brain
  say(ev: RunEvent): void
  autonomy: AutonomyLevel
  waitPlan(): Promise<boolean>
  /** Espera o filho (e quem o substituiu por limite); devolve o id final. */
  settle(id: string): Promise<string>
  now?: () => number
  /** Pasta pessoal (instruções globais e memória do Claude Code); padrão: a do usuário. */
  homeDir?: string
}

const childText = (store: Store, id: string) =>
  store.listEvents(id).flatMap(ev => (ev.type === 'text' ? [ev.text] : [])).join('\n').slice(-4000)

/** Chama o cérebro e valida; uma nova tentativa se a resposta vier inválida. */
async function askBrain<T>(call: () => Promise<unknown>, parse: (raw: unknown) => T | null, signal: AbortSignal): Promise<T | null | 'abort'> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) return 'abort'
    let raw: unknown
    try { raw = await call() } catch { return signal.aborted ? 'abort' : null }
    if (signal.aborted) return 'abort'
    const parsed = parse(raw)
    if (parsed) return parsed
  }
  return null
}

export async function runEsteira(ctx: EsteiraCtx): Promise<RunStatus> {
  const { runs, store, brain, signal, input, parentId, say } = ctx
  const e = ctx.profile.esteira!
  const cwd = input.projectPath
  const cerebro = e.cerebro as AgentId
  const brainAgent = getAgent(cerebro)
  const onUsage: UsageSink = ev => runs.recordUsage(parentId, cerebro, ev)
  const now = ctx.now ?? Date.now
  const failed = (msg: string): RunStatus => { say({ type: 'error', message: msg }); return 'error' }
  const brainFailed = () => failed(`O ${brainAgent.nome} não conseguiu planejar ou revisar. Tente de novo.`)
  const checkBrain = (): string | null => {
    const s = brainOut(store.latestLimits(), brainAgent.tool, now())
    if (!s.out) return null
    return `${brainAgent.nome} (${TOOL_NAME[brainAgent.tool]}) sem limite${s.until ? ` até ${quando(s.until)}` : ''} — o time parou`
  }

  const out = checkBrain()
  if (out) return failed(out)
  // O cérebro planeja com as mesmas regras do projeto que o executor recebe (CLAUDE.md, AGENTS.md e, se for Claude ou Codex, a memória).
  const trusted = brainAgent.transport.kind === 'cli' && (brainAgent.tool === 'claude' || brainAgent.tool === 'codex')
  const memory = trusted ? loadProjectMemory(cwd, ctx.homeDir ?? homedir()) : ''
  const instructions = [await loadInstructions(cwd, ctx.homeDir ?? homedir()), memory && `## Memória do projeto (Claude Code)\n\n${memory}`].filter(Boolean).join('\n\n')
  const plan = await askBrain<EsteiraPlan>(() => brain.plan({ cwd, prompt: input.prompt, cerebro, signal, onUsage, instructions }), parseEsteiraPlan, signal)
  if (plan === 'abort') return 'cancelled'
  if (!plan) return brainFailed()
  say({ type: 'esteira_plan', plan, volta: 0 })

  if (ctx.autonomy !== 'autonomous' && !(await ctx.waitPlan())) {
    if (!signal.aborted) say({ type: 'text', text: 'Plano recusado; nada foi alterado.' })
    return 'cancelled'
  }

  const readyIds = async () => {
    const ids = [e.executor, e.tester, ...(e.reserva ? [e.reserva] : [])]
    const ok = await Promise.all(ids.map(async id => ((await runs.availability(id as AgentId)).ok ? id : null)))
    return new Set(ok.filter(Boolean) as string[])
  }

  /** Roda um papel; devolve o texto do filho ou o status que encerra o pedido. */
  const step = async (role: 'executor' | 'tester', prompt: string): Promise<{ text: string } | { stop: RunStatus }> => {
    const ready = await readyIds()
    const pick = pickForRole(role, e, id => ready.has(id))
    if (!pick) {
      const who = [e[role], e.reserva].filter(Boolean).map(id => getAgent(id as AgentId).nome).join(' e ')
      return { stop: failed(`Ninguém disponível para ${role === 'executor' ? 'executar' : 'testar'}: ${who} ${e.reserva ? 'estão indisponíveis' : 'está indisponível'}.`) }
    }
    if (pick.swappedFrom) {
      const hint = (await runs.availability(pick.swappedFrom as AgentId))
      const reason = `${getAgent(pick.swappedFrom as AgentId).nome} indisponível${hint.ok ? '' : `: ${hint.hint}`}`
      say({ type: 'esteira_swap', role, from: pick.swappedFrom as AgentId, to: pick.id as AgentId, reason })
    }
    if (signal.aborted) return { stop: 'cancelled' }
    const id = await runs.startChild({ projectPath: cwd, conversationId: input.conversationId, agentId: pick.id as AgentId, parentRunId: parentId, prompt, write: true })
    ctx.active.add(id)
    if (signal.aborted) runs.cancel(id)
    say({ type: 'child_started', runId: id, agentId: pick.id as AgentId, task: role === 'executor' ? plan.tarefa : `Testar: ${plan.pronto}` })
    const final = await ctx.settle(id)
    ctx.active.delete(final)
    if (signal.aborted) return { stop: 'cancelled' }
    const run = store.getRun(final)
    const nome = getAgent((run?.agentId ?? pick.id) as AgentId).nome
    if (run?.status === 'error') { say({ type: 'text', text: `Parei porque o ${nome} falhou.` }); return { stop: 'error' } }
    if (run?.status === 'cancelled') { say({ type: 'text', text: `Parei porque o passo do ${nome} foi cancelado.` }); return { stop: 'cancelled' } }
    return { text: childText(store, final) }
  }

  let feedback: string | undefined
  for (let volta = 0; ; volta++) {
    const ex = await step('executor', executorPrompt(plan, feedback))
    if ('stop' in ex) return ex.stop
    const te = await step('tester', testerPrompt(plan, ex.text))
    if ('stop' in te) return te.stop
    const outNow = checkBrain()
    if (outNow) return failed(outNow)
    const review = await askBrain<EsteiraReview>(
      () => brain.review({ cwd, prompt: input.prompt, plan, executor: ex.text, tester: te.text, cerebro, signal, onUsage, instructions }), parseEsteiraReview, signal)
    if (review === 'abort') return 'cancelled'
    if (!review) return brainFailed()
    say({ type: 'esteira_review', pronto: review.pronto, falta: review.falta, volta })
    if (review.pronto) return 'done'
    if (volta >= e.maxVoltas) {
      say({ type: 'text', text: `Parei depois de ${e.maxVoltas} voltas. Falta: ${review.falta}` })
      return 'error'
    }
    feedback = review.falta
  }
}
