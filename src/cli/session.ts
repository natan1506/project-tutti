import { basename } from 'node:path'
import { getAgent, type AgentId, type ToolKind } from '@shared/agents'
import { AUTONOMY_LEVELS, isAutonomyLevel } from '@shared/autonomy'
import type { RunEvent } from '@shared/events'
import type { Project } from '@shared/models'
import type { EsteiraRole, Profile } from '@shared/profiles'
import type { UsageSnapshot, UsageSource } from '@shared/usage'
import type { Core } from '../main/core'
import { isGitRepo } from '../main/git/git'
import type { Command, ConfigKey } from './commands'
import { eventLine, type Line } from './lines'

// Estado da tela do terminal, sem React (spec tutti-terminal §4): projeto, conversa, linhas, pendência e comandos.

export type Pending = { kind: 'approval' | 'plan' | 'question'; id: string; text: string }
export interface RunResult { exit?: true; message?: string }

/** O que a tela (App) usa da sessão. */
export interface SessionView {
  header(): string
  esteiraAgents(): { nome: string; tool: UsageSource }[]
  usage(): UsageSnapshot
  lines(): Line[]
  pending(): Pending | null
  run(cmd: Command): Promise<RunResult>
  answer(value: string): void
  say(text: string, color?: Line['color']): void
  subscribe(fn: () => void): () => void
}

const ROLES: EsteiraRole[] = ['cerebro', 'executor', 'tester', 'reserva']
const ROLE_NAME: Record<EsteiraRole, string> = { cerebro: 'cérebro', executor: 'executor', tester: 'tester', reserva: 'reserva' }
const TOOL_NAME: Record<ToolKind, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Antigravity', opencode: 'opencode' }
const MAX_LINES = 500
const sum = (t: { input: number; output: number }) => t.input + t.output
const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n))

export class Session implements SessionView {
  readonly project: Project
  conversationId: string
  private out: Line[] = []
  private waiting: Pending | null = null
  private listeners = new Set<() => void>()
  private snap: UsageSnapshot
  private lastPlan = ''

  constructor(private core: Core, readonly cwd: string) {
    this.project = core.store.upsertProject(cwd)
    // Terminal é para a esteira: projeto sem perfil escolhido abre no Trabalho.
    const chosen = core.store.getSetting<string>(`profile:${this.project.id}`)
    const trabalho = core.profiles.all().find(p => p.esteira && p.nome === 'Trabalho')
    if (!chosen && trabalho) core.profiles.setActive(this.project.id, trabalho.id)
    this.conversationId = (core.store.listConversations(this.project.id)[0] ?? core.store.createConversation(this.project.id, 'Terminal')).id
    this.snap = core.usage.snapshot()
    this.loadHistory()
  }

  // ——— leitura ———

  header(): string { return `Tutti · ${basename(this.cwd)}` }
  lines(): Line[] { return this.out }
  pending(): Pending | null { return this.waiting }
  usage(): UsageSnapshot { return this.snap }
  profile(): Profile { return this.core.profiles.activeFor(this.project.id) }
  profileName(): string { return this.profile().nome }

  esteiraAgents(): { nome: string; tool: UsageSource }[] {
    const e = this.profile().esteira
    if (!e) return []
    return ROLES.flatMap(r => (e[r] ? [e[r]!] : [])).map(id => { const a = getAgent(id as AgentId); return { nome: a.nome, tool: a.transport.kind === 'api' ? 'api' : a.tool } })
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  say(text: string, color?: Line['color']): void {
    this.push({ text, ...(color ? { color } : {}) })
  }

  // ——— eventos do núcleo ———

  onUsage(s: UsageSnapshot): void {
    this.snap = s
    this.changed()
  }

  onEvent(runId: string, ev: RunEvent): void {
    if (this.core.store.getRun(runId)?.conversationId !== this.conversationId) return
    const run = this.core.store.getRun(runId)!
    if (ev.type === 'esteira_plan') this.lastPlan = `Plano: ${ev.plan.tarefa} · Pronto quando: ${ev.plan.pronto}`
    if (ev.type === 'approval_request') this.waiting = { kind: 'approval', id: ev.id, text: `${getAgent(run.agentId).nome} quer usar ${ev.toolName}: ${ev.summary}` }
    if (ev.type === 'plan_request') this.waiting = { kind: 'plan', id: ev.id, text: `${this.lastPlan || 'Plano pronto.'} Aprova?` }
    if (ev.type === 'question') this.waiting = { kind: 'question', id: ev.id, text: `${getAgent(run.agentId).nome} pergunta: ${ev.text}` }
    if ((ev.type === 'approval_resolved' || ev.type === 'plan_resolved' || ev.type === 'question_answered') && this.waiting?.id === ev.id) this.waiting = null
    if (ev.type === 'run_finished' && !run.parentRunId) this.waiting = null
    const line = this.lineFor(run.parentRunId, run.agentId, ev)
    if (line) this.push(line)
    else this.changed()
  }

  private lineFor(parentRunId: string | null, agentId: AgentId, ev: RunEvent): Line | null {
    // Passo de um filho: só o texto final e as ferramentas, recuados; o fim do filho não vira "Pronto.".
    if (parentRunId) {
      if (ev.type === 'run_finished' || ev.type === 'diff' || ev.type === 'queued') return null
      const l = eventLine(ev, id => getAgent(id).nome)
      if (!l) return null
      return ev.type === 'text' ? { text: `    ${getAgent(agentId).nome}: ${l.text.slice(0, 600)}`, color: 'gray' } : { ...l, text: `  ${l.text}` }
    }
    return eventLine(ev, id => getAgent(id).nome)
  }

  // ——— respostas e comandos ———

  answer(value: string): void {
    const p = this.waiting
    if (!p) return
    const yes = /^(s|sim|y|yes)$/i.test(value.trim())
    if (p.kind === 'approval') this.core.runs.respondApproval(p.id, yes)
    else if (p.kind === 'plan') this.core.team.respondPlan(p.id, yes)
    else this.core.runs.answerQuestion(p.id, value)
    this.waiting = null
    this.changed()
  }

  async run(cmd: Command): Promise<RunResult> {
    switch (cmd.kind) {
      case 'exit': return { exit: true }
      case 'send': return this.send(cmd.text)
      case 'stop': return { message: `Parei ${this.core.runs.cancelAll()} pedido(s).` }
      case 'new': {
        this.conversationId = this.core.store.createConversation(this.project.id, 'Terminal').id
        this.out = []
        this.changed()
        return { message: 'Conversa nova.' }
      }
      case 'history': return this.history(cmd.index)
      case 'undo': return this.undo()
      case 'agents': return { message: this.agentsText() }
      case 'usage': return { message: this.usageText() }
      case 'config': return this.config(cmd.key, cmd.value)
      case 'unknown': return { message: `Comando desconhecido: /${cmd.name}` }
    }
  }

  private async send(text: string): Promise<RunResult> {
    if (!text) return {}
    this.core.profiles.reload()
    const profile = this.profile()
    if (!profile.esteira) return { message: `Este projeto usa o perfil ${profile.nome}, sem esteira. Use /config perfil Trabalho.` }
    this.push({ text: `› ${text}`, color: 'cyan' })
    try {
      await this.core.team.start({ projectPath: this.cwd, conversationId: this.conversationId, prompt: text, profileId: profile.id })
      return {}
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e)
      const cerebro = getAgent(profile.esteira.cerebro as AgentId)
      if (code === 'TOOL_UNAVAILABLE') return { message: `${cerebro.nome} (${TOOL_NAME[cerebro.tool]}) não está pronto: confira se está instalado e logado.` }
      return { message: `Não consegui começar: ${code}` }
    }
  }

  private history(index?: number): RunResult {
    const convs = this.core.store.listConversations(this.project.id)
    if (index === undefined) {
      return { message: convs.map((c, i) => `${i + 1}. ${c.title} · ${new Date(c.createdAt).toLocaleString('pt-BR')}${c.id === this.conversationId ? ' (atual)' : ''}`).join('\n') || 'Nenhuma conversa.' }
    }
    const c = convs[index - 1]
    if (!c) return { message: `Não há conversa ${index}.` }
    this.conversationId = c.id
    this.loadHistory()
    return { message: `Retomei: ${c.title}.` }
  }

  private loadHistory(): void {
    this.out = []
    for (const r of this.core.store.listRuns(this.conversationId)) {
      if (!r.parentRunId) this.out.push({ text: `› ${r.prompt}`, color: 'cyan' })
      for (const ev of this.core.store.listEvents(r.id)) {
        const l = this.lineFor(r.parentRunId, r.agentId, ev)
        if (l) this.out.push(l)
      }
    }
    this.out = this.out.slice(-MAX_LINES)
    this.changed()
  }

  private async undo(): Promise<RunResult> {
    if (!(await isGitRepo(this.cwd))) return { message: 'Esta pasta não usa git: não há o que desfazer.' }
    const last = this.core.store.listRuns(this.conversationId).filter(r => !r.parentRunId && r.hasCheckpoint && r.status !== 'running').at(-1)
    if (!last) return { message: 'Nada para desfazer nesta conversa.' }
    const r = await this.core.runs.undo(last.id)
    return { message: r.ok ? `Desfeito: ${last.prompt}` : `Não consegui desfazer: ${r.conflicts.join(', ') || 'o ponto de restauração não existe mais'} mudou depois.` }
  }

  private roleOf(id: string): string {
    const e = this.profile().esteira
    const role = e && ROLES.find(r => e[r] === id)
    return role ? ROLE_NAME[role] : 'fora da esteira'
  }

  private agentsText(): string {
    const p = this.profile()
    return [`Perfil ${p.nome}:`, ...p.agents.map(a => {
      const d = getAgent(a.id as AgentId)
      const tool = d.transport.kind === 'api' ? 'API' : TOOL_NAME[d.tool]
      const row = this.snap.rows.find(r => r.tool === (d.transport.kind === 'api' ? 'api' : d.tool))
      const uso = row?.utilization != null ? `${row.estimated ? '~' : ''}${Math.round(row.utilization)}%` : '—'
      return `  ${d.nome} — ${tool}${d.defaultModel ? ` ${d.defaultModel}` : ''} — ${this.roleOf(a.id)} — uso ${uso}`
    })].join('\n')
  }

  private usageText(): string {
    const by = new Map<string, number>()
    for (const r of this.core.store.tokensByRun(this.conversationId)) by.set(r.agentId, (by.get(r.agentId) ?? 0) + sum(r.tokens))
    const gasto = [...by].map(([id, n]) => `  ${getAgent(id as AgentId).nome}: ${fmtTokens(n)} tokens`)
    const limites = this.snap.rows.filter(r => r.utilization != null).map(r =>
      `  ${r.tool === 'api' ? 'API' : TOOL_NAME[r.tool as ToolKind]}: ${r.estimated ? '~' : ''}${Math.round(r.utilization!)}%${r.resetsAt ? ` · volta ${new Date(r.resetsAt).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`)
    return ['Gasto nesta conversa:', ...(gasto.length ? gasto : ['  nada ainda']), 'Limites:', ...(limites.length ? limites : ['  sem dado'])].join('\n')
  }

  private config(key?: ConfigKey, value?: string): RunResult {
    const p = this.profile()
    const level = this.core.runs.autonomyOf(this.cwd)
    if (!key) {
      const e = p.esteira
      return { message: [`Perfil: ${p.nome}`,
        ...(e ? ROLES.flatMap(r => (e[r] ? [`  ${ROLE_NAME[r]}: ${getAgent(e[r] as AgentId).nome}`] : [])) : ['  sem esteira']),
        `Autonomia: ${level}`, ...(e ? [`Voltas: ${e.maxVoltas}`] : [])].join('\n') }
    }
    if (!value) return { message: `Use /config ${key} <valor>.` }
    if (key === 'autonomia') {
      if (!isAutonomyLevel(value)) return { message: `Autonomia: use ${AUTONOMY_LEVELS.join(', ')}.` }
      this.core.store.setSetting(`autonomy:${this.cwd}`, value)
      return { message: `Autonomia: ${value}.` }
    }
    if (key === 'perfil') {
      const found = this.core.profiles.all().find(x => x.nome.toLowerCase() === value.toLowerCase())
      if (!found) return { message: `Não achei o perfil ${value}.` }
      this.core.profiles.setActive(this.project.id, found.id)
      this.changed()
      return { message: `Perfil: ${found.nome}.` }
    }
    if (!p.esteira) return { message: `O perfil ${p.nome} não tem esteira.` }
    if (p.builtin) return { message: `O perfil ${p.nome} não pode ser editado.` }
    let esteira = p.esteira
    if (key === 'voltas') {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1 || n > 5) return { message: 'Voltas: um número de 1 a 5.' }
      esteira = { ...esteira, maxVoltas: n }
    } else {
      const agent = p.agents.find(a => a.nome.toLowerCase() === value.toLowerCase())
      if (!agent) return { message: `Não achei ${value} no perfil ${p.nome}.` }
      esteira = { ...esteira, [key]: agent.id }
    }
    const r = this.core.profiles.save({ ...p, esteira })
    if (!r.ok) return { message: r.errors.join(' ') }
    this.changed()
    return { message: this.config().message }
  }

  // ——— interno ———

  private push(l: Line): void {
    this.out.push(l)
    if (this.out.length > MAX_LINES) this.out.splice(0, this.out.length - MAX_LINES)
    this.changed()
  }

  private changed(): void {
    for (const fn of this.listeners) fn()
  }
}
