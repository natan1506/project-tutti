import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { getAgent, type AgentId, type ToolKind } from '@shared/agents'
import { AUTONOMY_LABEL, AUTONOMY_LEVELS, isAutonomyLevel } from '@shared/autonomy'
import type { RunEvent } from '@shared/events'
import type { Project } from '@shared/models'
import type { EsteiraRole, Profile } from '@shared/profiles'
import type { UsageSnapshot, UsageSource } from '@shared/usage'
import type { Core } from '../main/core'
import { isGitRepo, runGit } from '../main/git/git'
import type { Command, ConfigKey } from './commands'
import { bannerLines } from './banner'
import { eventLine, type Line } from './lines'

// Estado da tela do terminal, sem React (spec tutti-terminal §4): projeto, conversa, linhas, pendência e comandos.

export type Pending = { kind: 'approval' | 'plan' | 'question'; id: string; text: string }
export type PanelKind = 'config' | 'agents' | 'history' | 'usage' | 'help' | 'mcp'
export interface RunResult { exit?: true; message?: string; panel?: PanelKind }
export interface Option { value: string; label: string; hint?: string }
export interface ConfigRow { key: ConfigKey; label: string; value: string; hint: string; options: Option[] }
export interface AgentRow { nome: string; ia: string; modelo: string; papel: string; uso: string; color?: string }
export interface HistoryRow { index: number; title: string; when: string; prompts: number; current: boolean }
export interface McpRow { id: string; nome: string; estado: string; modo: string; leitura: number; escrita: number; precisaDoApp: boolean }
export interface UsageView { gasto: { nome: string; tokens: string }[]; limites: { ia: string; uso: string; volta: string }[] }

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
  /** Resposta de comando: bloco separado, com ⎿ na primeira linha. */
  reply(text: string): void
  configView(): ConfigRow[]
  setConfig(key: ConfigKey, value: string): string
  agentsView(): AgentRow[]
  historyView(): HistoryRow[]
  resume(index: number): string
  usageView(): UsageView
  mcpView(): McpRow[]
  toggleMcp(id: string): void
  mcpImportable(): Promise<{ nome: string }[]>
  importMcp(nome: string): Promise<string>
  subscribe(fn: () => void): () => void
}

const ROW_HINT: Record<ConfigKey, string> = {
  perfil: 'Qual time este projeto usa',
  cerebro: 'Planeja o pedido e revisa o resultado',
  executor: 'Implementa a tarefa que o cérebro escreveu',
  tester: 'Roda os testes e confere o critério de pronto',
  reserva: 'Assume quando o executor ou o tester não está disponível',
  autonomia: 'Quando o time para e pede a sua aprovação',
  voltas: 'Quantas vezes o cérebro pode devolver ao executor',
}
const ROW_LABEL: Record<ConfigKey, string> = { perfil: 'Perfil', cerebro: 'Cérebro', executor: 'Executor', tester: 'Tester', reserva: 'Reserva', autonomia: 'Autonomia', voltas: 'Voltas' }
const AUTONOMY_HINT: Record<string, string> = {
  ask_all: 'pede aprovação para tudo, inclusive o plano',
  accept_edits: 'você aprova o plano; edições no projeto seguem',
  autonomous: 'não para: plano e trabalho seguem direto',
}

const ROLES: EsteiraRole[] = ['cerebro', 'executor', 'tester', 'reserva']
const ROLE_NAME: Record<EsteiraRole, string> = { cerebro: 'cérebro', executor: 'executor', tester: 'tester', reserva: 'reserva' }
const TOOL_NAME: Record<ToolKind, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Antigravity', opencode: 'opencode' }
const MAX_LINES = 500
/** Eventos do pedido que abrem um bloco novo na conversa. */
const SPACED = new Set<RunEvent['type']>(['esteira_plan', 'child_started', 'esteira_review'])
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

  /**
   * Abre na raiz do repositório quando `cwd` está dentro de um: o projeto (e a trava entre app e terminal)
   * é o mesmo, seja qual for a subpasta.
   */
  static async open(core: Core, cwd: string, version = ''): Promise<Session> {
    let root = realpathSync(cwd)
    try { root = realpathSync((await runGit(cwd, ['rev-parse', '--show-toplevel'])).trim()) } catch { /* sem git: a própria pasta */ }
    return new Session(core, root, version)
  }

  constructor(private core: Core, readonly cwd: string, private version = '') {
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
    if (line) { if (!run.parentRunId && SPACED.has(ev.type)) this.space(); this.push(line) }
    else this.changed()
  }

  /** Linha em branco antes de um bloco novo (sem repetir se já houver uma). */
  private space(): void {
    if (this.out.length && this.out.at(-1)!.text !== '') this.out.push({ text: '' })
  }

  private lineFor(parentRunId: string | null, agentId: AgentId, ev: RunEvent): Line | null {
    // Passo de um filho: só o texto final e as ferramentas, recuados; o fim do filho não vira "Pronto.".
    if (parentRunId) {
      if (ev.type === 'run_finished' || ev.type === 'diff' || ev.type === 'queued') return null
      const l = eventLine(ev, id => getAgent(id).nome)
      if (!l) return null
      return ev.type === 'text' ? { text: `    ${getAgent(agentId).nome}: ${l.text.slice(0, 600)}`, color: 'gray' } : { ...l, text: `  ${l.text}` }
    }
    // A tarefa de uma etapa pode ser o plano inteiro: na linha vai só o começo.
    if (ev.type === 'child_started') {
      const first = ev.task.split('\n')[0].trim()
      return { text: `${getAgent(ev.agentId).nome}  ${first.length > 110 ? `${first.slice(0, 109)}…` : first}` }
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
      case 'new':
      case 'clear': {
        this.conversationId = this.core.store.createConversation(this.project.id, 'Terminal').id
        this.out = this.banner()
        this.changed()
        return cmd.kind === 'new' ? { message: 'Conversa nova.' } : {}
      }
      case 'help': return { panel: 'help' }
      case 'history': return cmd.index === undefined ? { panel: 'history' } : this.history(cmd.index)
      case 'undo': return this.undo()
      case 'agents': return { panel: 'agents' }
      case 'usage': return { panel: 'usage' }
      case 'config': return cmd.key ? this.config(cmd.key, cmd.value) : { panel: 'config' }
      case 'mcp': {
        if (!cmd.add) return { panel: 'mcp' }
        const r = await this.core.mcp.save({ id: '', nome: cmd.add.nome, transport: { kind: 'stdio', command: cmd.add.command, args: cmd.add.args }, secretNames: [], mode: 'read', agents: 'all', enabled: true, tools: [] })
        if (!r.ok) return { message: r.errors.join(' ') }
        return { message: r.def.lastError ? `${r.def.nome} salvo desligado: não conectou (${r.def.lastError}).` : `${r.def.nome} instalado, só leitura, para todos os agentes (${r.def.tools.filter(t => t.read).length} ferramentas de leitura).` }
      }
      case 'unknown': return { message: `Comando desconhecido: /${cmd.name}` }
    }
  }

  private async send(text: string): Promise<RunResult> {
    if (!text) return {}
    // Sem git, a pasta pessoal ou a raiz dariam escrita ao executor em tudo, sem ponto de restauração.
    if ([homedir(), '/'].some(p => realpathSync(p) === this.cwd)) return { message: 'Abra o tutti dentro da pasta de um projeto (não na pasta pessoal nem na raiz).' }
    this.core.profiles.reload()
    const profile = this.profile()
    if (!profile.esteira) return { message: `Este projeto usa o perfil ${profile.nome}, sem esteira. Use /config perfil Trabalho.` }
    this.space()
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

  private banner(): Line[] {
    const e = this.profile().esteira
    const team = e ? ROLES.flatMap(r => (e[r] ? [{ id: e[r]!, papel: ROLE_NAME[r] }] : [])).map(({ id, papel }) => {
      const a = getAgent(id as AgentId)
      return { nome: a.nome, tool: a.transport.kind === 'api' ? 'API' : TOOL_NAME[a.tool], papel }
    }) : []
    return bannerLines({ version: this.version, project: basename(this.cwd), team })
  }

  private loadHistory(): void {
    this.out = this.banner()
    // O trabalho de cada etapa entra logo depois do "child_started" dela, como aconteceu ao vivo.
    const runs = this.core.store.listRuns(this.conversationId)
    const byId = new Map(runs.map(r => [r.id, r]))
    const replay = (r: (typeof runs)[number]) => {
      for (const ev of this.core.store.listEvents(r.id)) {
        const l = this.lineFor(r.parentRunId, r.agentId, ev)
        if (l) { if (!r.parentRunId && SPACED.has(ev.type)) this.space(); this.out.push(l) }
        const child = ev.type === 'child_started' ? byId.get(ev.runId) : undefined
        if (child) replay(child)
      }
    }
    for (const r of runs) {
      if (r.parentRunId) continue
      this.space()
      this.out.push({ text: `› ${r.prompt}`, color: 'cyan' })
      replay(r)
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

  // ——— painéis ———

  configView(): ConfigRow[] {
    const p = this.profile()
    const e = p.esteira
    const level = this.core.runs.autonomyOf(this.cwd)
    const agentOpt = (a: Profile['agents'][number]): Option => {
      const d = getAgent(a.id as AgentId)
      return { value: a.id, label: d.nome, hint: d.transport.kind === 'api' ? 'API' : TOOL_NAME[d.tool] }
    }
    const nomeDe = (id?: string) => (id ? getAgent(id as AgentId).nome : '—')
    const rows: ConfigRow[] = [{
      key: 'perfil', label: ROW_LABEL.perfil, value: p.nome, hint: ROW_HINT.perfil,
      options: this.core.profiles.all().map(x => ({ value: x.id, label: x.nome, hint: x.esteira ? 'com esteira' : 'sem esteira' })),
    }]
    if (e) {
      for (const r of ROLES) {
        const opts = p.agents.filter(a => r === 'cerebro' || !a.readOnly).map(agentOpt)
        rows.push({ key: r, label: ROW_LABEL[r], value: nomeDe(e[r]), hint: ROW_HINT[r], options: opts })
      }
    }
    rows.push({
      key: 'autonomia', label: ROW_LABEL.autonomia, value: AUTONOMY_LABEL[level], hint: ROW_HINT.autonomia,
      options: AUTONOMY_LEVELS.map(l => ({ value: l, label: AUTONOMY_LABEL[l], hint: AUTONOMY_HINT[l] })),
    })
    if (e) rows.push({ key: 'voltas', label: ROW_LABEL.voltas, value: String(e.maxVoltas), hint: ROW_HINT.voltas, options: [1, 2, 3, 4, 5].map(n => ({ value: String(n), label: String(n) })) })
    return rows
  }

  setConfig(key: ConfigKey, value: string): string {
    return this.config(key, value).message ?? ''
  }

  agentsView(): AgentRow[] {
    return this.profile().agents.map(a => {
      const d = getAgent(a.id as AgentId)
      const row = this.snap.rows.find(r => r.tool === (d.transport.kind === 'api' ? 'api' : d.tool))
      return {
        nome: d.nome, ia: d.transport.kind === 'api' ? 'API' : TOOL_NAME[d.tool], modelo: d.defaultModel ?? 'padrão da CLI', papel: this.roleOf(a.id),
        uso: row?.utilization != null ? `${row.estimated ? '~' : ''}${Math.round(row.utilization)}%` : '—',
      }
    })
  }

  historyView(): HistoryRow[] {
    return this.core.store.listConversations(this.project.id).map((c, i) => ({
      index: i + 1, title: this.core.store.listRuns(c.id).find(r => !r.parentRunId)?.prompt.slice(0, 70) ?? c.title,
      when: new Date(c.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      prompts: this.core.store.listRuns(c.id).filter(r => !r.parentRunId).length, current: c.id === this.conversationId,
    }))
  }

  resume(index: number): string {
    return this.history(index).message ?? ''
  }

  usageView(): UsageView {
    const by = new Map<string, number>()
    for (const r of this.core.store.tokensByRun(this.conversationId)) by.set(r.agentId, (by.get(r.agentId) ?? 0) + sum(r.tokens))
    return {
      gasto: [...by].map(([id, n]) => ({ nome: getAgent(id as AgentId).nome, tokens: fmtTokens(n) })),
      limites: this.snap.rows.filter(r => r.utilization != null).map(r => ({
        ia: r.tool === 'api' ? 'API' : TOOL_NAME[r.tool as ToolKind], uso: `${r.estimated ? '~' : ''}${Math.round(r.utilization!)}%`,
        volta: r.resetsAt ? new Date(r.resetsAt).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—',
      })),
    }
  }

  mcpView(): McpRow[] {
    return this.core.mcp.all().map(d => ({
      id: d.id, nome: d.nome, estado: d.lastError ? 'com erro' : d.enabled ? 'ligado' : 'desligado', modo: d.mode === 'write' ? 'pode escrever' : 'só leitura',
      leitura: d.tools.filter(t => t.read).length, escrita: d.tools.filter(t => !t.read).length,
      // O terminal não lê o Keychain do app: MCP com segredo só funciona pelo app.
      precisaDoApp: d.secretNames.some(n => this.core.mcp.secretsOf(d.id)[n] === undefined),
    }))
  }

  toggleMcp(id: string): void {
    const d = this.core.mcp.all().find(x => x.id === id)
    if (d) this.core.mcp.setEnabled(id, !d.enabled)
    this.changed()
  }

  async mcpImportable(): Promise<{ nome: string }[]> {
    return this.core.mcp.importableFromClaudeCode().map(i => ({ nome: i.nome }))
  }

  async importMcp(nome: string): Promise<string> {
    const r = await this.core.mcp.importFromClaudeCode(nome)
    this.changed()
    if (!r.ok) return r.errors.join(' ')
    return r.def.lastError ? `${nome} importado, mas não conectou: ${r.def.lastError}` : `${nome} importado${r.def.enabled ? ', só leitura, para todos' : ' (desligado)'}.`
  }

  reply(text: string): void {
    const [first, ...rest] = text.split('\n')
    this.out.push({ text: '' }, { text: `  ⎿ ${first}`, color: 'gray' }, ...rest.map(t => ({ text: `    ${t}`, color: 'gray' as const })))
    if (this.out.length > MAX_LINES) this.out.splice(0, this.out.length - MAX_LINES)
    this.changed()
  }

  private roleOf(id: string): string {
    const e = this.profile().esteira
    const role = e && ROLES.find(r => e[r] === id)
    return role ? ROLE_NAME[role] : 'fora da esteira'
  }

  private config(key?: ConfigKey, value?: string): RunResult {
    const p = this.profile()
    if (!key) return { panel: 'config' }
    if (!value) return { message: `Use /config ${key} <valor>.` }
    if (key === 'autonomia') {
      if (!isAutonomyLevel(value)) return { message: `Autonomia: use ${AUTONOMY_LEVELS.join(', ')}.` }
      this.core.store.setSetting(`autonomy:${this.cwd}`, value)
      this.changed()
      return { message: `Autonomia: ${AUTONOMY_LABEL[value]} (${AUTONOMY_HINT[value]}).` }
    }
    if (key === 'perfil') {
      const found = this.core.profiles.all().find(x => x.id === value || x.nome.toLowerCase() === value.toLowerCase())
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
      const agent = p.agents.find(a => a.id === value || a.nome.toLowerCase() === value.toLowerCase())
      if (!agent) return { message: `Não achei ${value} no perfil ${p.nome}.` }
      esteira = { ...esteira, [key]: agent.id }
    }
    const r = this.core.profiles.save({ ...p, esteira })
    if (!r.ok) return { message: r.errors.join(' ') }
    this.changed()
    return { message: key === 'voltas' ? `Voltas: ${esteira.maxVoltas}.` : `${ROW_LABEL[key]}: ${getAgent(esteira[key] as AgentId).nome}.` }
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
