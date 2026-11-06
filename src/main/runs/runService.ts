import { randomUUID } from 'node:crypto'
import { agentsOfProfile, getAgent, knownAgent, type AgentDef, type AgentId, type ToolKind } from '@shared/agents'
import { isPaidApi, providerName, type ProviderId } from '@shared/profiles'
import type { AgentEvent, RunEvent, RunStatus } from '@shared/events'
import type { WindowKind } from '@shared/usage'
import { skillsInstructions, type SkillDraft } from '@shared/skills'
import { DEFAULT_AUTONOMY, type AutonomyLevel } from '@shared/autonomy'
import type { BrowserService } from '../browser/browserService'
import type { StartRunInput } from '@shared/models'
import type { AdapterRunOptions, AgentAdapter } from '../adapters/types'
import { diffBetween, patchBetween, snapshot, undo, type UndoResult } from '../git/checkpoint'
import { isGitRepo, runGit } from '../git/git'
import { buildContext, collectEntries } from '../context/conversationContext'
import { loadInstructions } from '../instructions/loadInstructions'
import type { Store } from '../store/db'
import { ProjectQueue } from './projectQueue'
import { writeClaudePlugin } from '../skills/claudePlugin'

interface Deps {
  store: Store
  adapters: Record<ToolKind, AgentAdapter | undefined>
  emit: (runId: string, ev: RunEvent) => void
  homeDir?: string
  /** Ferramenta instalada e logada? (padrão: sim) */
  toolReady?: (tool: ToolKind) => Promise<boolean>
  /** Chave do provedor salva? (agentes por API; padrão: sim) */
  keyReady?: (provider: ProviderId) => boolean
  /** Uso/limite medido num run (UsageService). */
  onUsage?: (runId: string, agentId: AgentId, ev: Extract<AgentEvent, { type: 'usage' | 'limit' }>) => void
  /** Skills marcadas para o agente (SkillService). */
  skillsFor?: (agentId: AgentId) => SkillDraft[]
  /** Pasta do plugin de skills de um agente Claude CLI. */
  skillPluginDir?: (agentId: AgentId) => string
  /** Nível de autonomia do projeto (padrão: Aceitar edições). */
  autonomyFor?: (projectPath: string) => AutonomyLevel
  /** O sandbox do macOS do Agent SDK existe nesta máquina? (padrão: sim) */
  sandboxAvailable?: () => boolean
  /** Navegador do Tutti, oferecido aos agentes Claude por CLI. */
  browser?: BrowserService
  /** Quantos pedidos estão ativos (rodando ou na fila), a cada mudança: liga o botão Parar tudo. */
  onActivity?: (active: number) => void
}

/** Assinatura do agente para retomar sessão: trocar transporte ou modelo começa sessão nova (spec custos-e-perfis §6). */
export const agentSignature = (a: AgentDef): string =>
  `${a.transport.kind}:${a.transport.kind === 'cli' ? a.transport.tool : a.transport.provider}:${a.defaultModel ?? ''}`

/** Modelo que o agente usa: por API sempre o do perfil, como `<provedor>/<modelo>`; por CLI o pedido pode escolher. */
export const effectiveModel = (a: AgentDef, requested?: string): string | undefined =>
  a.transport.kind === 'api' ? `${a.transport.provider}/${a.defaultModel ?? ''}` : requested

/** Quem o agente pode consultar no meio do trabalho: os "pode ser consultado" do mesmo perfil, menos ele mesmo. */
// Agente por API paga fica de fora: consulta não tem clique de confirmação (spec custos-e-perfis §10).
export const consultableFor = (a: AgentDef): AgentDef[] =>
  agentsOfProfile(a.profileId).filter(x => x.consultable && x.id !== a.id && x.transport.kind !== 'api')

/** Só erros que falam de sessão/conversa inexistente justificam recomeçar sem contexto (limite e rede não). */
const looksLikeStaleSession = (msg: string) => /session|conversation|thread|not found|no such|unknown id|404/i.test(msg)

const refs = (runId: string) => ({ before: `refs/time/runs/${runId}/before`, after: `refs/time/runs/${runId}/after` })

/** Ciclo de vida de um pedido a um agente: ponto de restauração → agente → diff → fim. */
export class RunService {
  private controllers = new Map<string, AbortController>()
  private approvals = new Map<string, (allowed: boolean) => void>()
  private questions = new Map<string, (answer: string | null) => void>()
  private finished = new Map<string, Promise<void>>()
  /** Runs com o agente de fato trabalhando (fora da fila). */
  private executing = new Set<string>()
  /** Avisos de limite: um por run por ferramenta. */
  private warned = new Set<string>()
  /** Runs que já entregaram o resultado (uso ou fim): avisar de limite não serve mais. */
  private delivered = new Set<string>()
  private warnings = new Map<string, { runId: string; to?: AgentId }>()
  /** O TeamService troca o passo do time quando um filho é substituído. */
  onChildHandoff?: (parentRunId: string, oldRunId: string, newRunId: Promise<string>, to: AgentId) => void

  /** Spec §6.2: um pedido por vez por projeto. Compartilhada com o TeamService (run-pai do time). */
  readonly queue = new ProjectQueue()

  constructor(private deps: Deps) {}

  /** Pedido direto a um agente: espera a vez do projeto, ponto de restauração, agente, diff. */
  async start(input: StartRunInput): Promise<string> {
    const adapter = await this.readyAdapter(input.agentId)
    if (!(await isGitRepo(input.projectPath))) throw new Error('NOT_A_GIT_REPO')
    const runId = this.open(input, true)
    const signal = this.controllers.get(runId)!.signal
    this.finished.set(runId, (async () => {
      if (!(await this.waitTurn(runId, input.projectPath, signal))) return
      try {
        await snapshot(input.projectPath, refs(runId).before)
        await this.execute(runId, input, adapter, signal, true)
      } catch (e) {
        this.record(runId, { type: 'error', message: e instanceof Error ? e.message : String(e) })
        this.close(runId, 'error')
      } finally {
        this.queue.release(input.projectPath, runId)
      }
    })())
    return runId
  }

  /** Passo de um pedido de time: sem fila e sem ponto de restauração próprios (o pai cuida dos dois). */
  async startChild(input: StartRunInput & { parentRunId: string }): Promise<string> {
    const adapter = await this.readyAdapter(input.agentId)
    const runId = this.open(input, false)
    this.finished.set(runId, this.execute(runId, input, adapter, this.controllers.get(runId)!.signal, false))
    return runId
  }

  /**
   * Espera a vez do projeto na fila. Cancelado enquanto espera: sai da fila, fecha `cancelled` e devolve false.
   * Também usado pelo TeamService para o run-pai.
   */
  async waitTurn(runId: string, projectPath: string, signal: AbortSignal): Promise<boolean> {
    let waited = false
    // Posição 0 só é anunciada para quem esperou: avisa o painel que o pedido saiu da fila.
    const turn = this.queue.acquire(projectPath, runId, pos => { if (pos > 0 || waited) { waited = true; this.record(runId, { type: 'queued', position: pos }) } })
    const aborted = new Promise<'abort'>(resolve => signal.addEventListener('abort', () => resolve('abort'), { once: true }))
    if ((await Promise.race([turn, aborted])) === 'abort' && this.queue.remove(projectPath, runId)) {
      this.close(runId, 'cancelled')
      return false
    }
    return !signal.aborted || this.queue.position(projectPath, runId) === 0
  }

  /** O agente pode trabalhar agora? CLI: ferramenta instalada e logada. API: opencode pronto e chave do provedor salva. */
  async availability(agentId: AgentId): Promise<{ ok: true } | { ok: false; hint: string }> {
    const agent = getAgent(agentId)
    if (!knownAgent(agentId) || agent.profileId.startsWith('removido:')) return { ok: false, hint: 'Agente removido' }
    if (!this.deps.adapters[agent.tool] || !(await (this.deps.toolReady?.(agent.tool) ?? true))) return { ok: false, hint: 'Ferramenta indisponível' }
    if (agent.transport.kind === 'api' && !(this.deps.keyReady?.(agent.transport.provider) ?? true)) {
      return { ok: false, hint: `Sem chave da ${providerName(agent.transport.provider)}` }
    }
    return { ok: true }
  }

  private async readyAdapter(agentId: AgentId): Promise<AgentAdapter> {
    if (!(await this.availability(agentId)).ok) throw new Error('TOOL_UNAVAILABLE')
    return this.deps.adapters[getAgent(agentId).tool]!
  }

  /** Cria o run (status running) e o controle de cancelamento. */
  open(input: StartRunInput, hasCheckpoint: boolean): string {
    const runId = randomUUID()
    this.deps.store.createRun({
      id: runId, conversationId: input.conversationId, agentId: input.agentId, prompt: input.prompt, startedAt: Date.now(),
      hasCheckpoint, ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}), agentSig: agentSignature(getAgent(input.agentId)),
    })
    this.record(runId, { type: 'run_started', runId, agentId: input.agentId })
    this.controllers.set(runId, new AbortController())
    this.deps.onActivity?.(this.controllers.size)
    return runId
  }

  /**
   * Uso não é conversa: vai para o banco e para o painel, não para o histórico do chat. Agente por API paga conta
   * como fonte 'api'. Também usado pelo TeamService (confirmações e cérebro do coordenador).
   */
  recordUsage(runId: string, agentId: AgentId, ev: Extract<AgentEvent, { type: 'usage' | 'limit' }>): void {
    if (ev.type === 'usage' && isPaidApi(getAgent(agentId))) ev = { ...ev, tool: 'api' }
    if (ev.type === 'usage') this.deps.store.recordUsage(runId, agentId, ev.tool, ev.tokens, Date.now())
    else this.deps.store.recordLimit(ev.limit)
    this.deps.emit(runId, ev)
    this.deps.onUsage?.(runId, agentId, ev)
  }

  /** Fecha o run: evento final, status gravado, controle liberado. */
  close(runId: string, status: RunStatus, sessionId?: string): void {
    this.record(runId, { type: 'run_finished', status })
    this.deps.store.finishRun(runId, status, sessionId)
    if (this.controllers.delete(runId)) this.deps.onActivity?.(this.controllers.size)
  }

  signalOf(runId: string): AbortSignal | undefined {
    return this.controllers.get(runId)?.signal
  }

  whenFinished(runId: string): Promise<void> {
    return this.finished.get(runId) ?? Promise.resolve()
  }

  respondApproval(approvalId: string, allowed: boolean): void {
    this.approvals.get(approvalId)?.(allowed)
  }

  answerQuestion(questionId: string, answer: string): void {
    this.questions.get(questionId)?.(answer)
  }

  cancel(runId: string): void {
    this.controllers.get(runId)?.abort()
  }

  /**
   * Parar tudo (design §5): aborta todo pedido ativo de todos os projetos, inclusive a fila e os do Time.
   * Consultas e chamadas do coordenador seguem esses sinais. O que já foi feito fica (diff e Desfazer).
   */
  cancelAll(): number {
    const all = [...this.controllers.values()]
    for (const c of all) c.abort()
    return all.length
  }

  activeCount(): number {
    return this.controllers.size
  }

  async undo(runId: string, paths?: string[]): Promise<UndoResult> {
    const dir = this.deps.store.projectPathForRun(runId)
    const { before, after } = refs(runId)
    if (!dir) return { ok: false, conflicts: [] }
    try {
      for (const ref of [before, after]) await runGit(dir, ['rev-parse', '--verify', '-q', ref])
    } catch {
      return { ok: false, conflicts: [] }
    }
    return undo(dir, before, after, paths)
  }

  async patch(runId: string, path?: string): Promise<string> {
    const dir = this.deps.store.projectPathForRun(runId)
    if (!dir) return ''
    const { before, after } = refs(runId)
    try {
      return await patchBetween(dir, before, after, path ? [path] : undefined)
    } catch {
      return ''
    }
  }

  /** Na inicialização: pedidos que ficaram rodando viram 'interrupted' e ganham ponto final para poderem ser desfeitos. */
  async recover(): Promise<void> {
    const orphans = this.deps.store.listRunsByStatus('running')
    this.deps.store.markInterruptedRuns()
    for (const run of orphans) {
      const dir = this.deps.store.projectPathForRun(run.id)
      const { before, after } = refs(run.id)
      if (!dir) continue
      try {
        await runGit(dir, ['rev-parse', '--verify', '-q', before])
        await snapshot(dir, after)
        this.deps.store.appendEvent(run.id, { type: 'diff', files: await diffBetween(dir, before, after) })
      } catch {
        // Sem ponto inicial ou pasta inacessível: desfazer fica indisponível para esse pedido.
      }
    }
  }

  record(runId: string, ev: RunEvent): void {
    this.deps.store.appendEvent(runId, ev)
    this.deps.emit(runId, ev)
  }

  private requestApproval(runId: string, signal: AbortSignal): AdapterRunOptions['requestApproval'] {
    return async ({ toolName, summary, reason }) => {
      const id = randomUUID()
      this.record(runId, { type: 'approval_request', id, toolName, summary, ...(reason ? { reason } : {}) })
      const allowed = await new Promise<boolean>(resolve => {
        if (signal.aborted) return resolve(false)
        this.approvals.set(id, resolve)
        signal.addEventListener('abort', () => resolve(false), { once: true })
      })
      this.approvals.delete(id)
      this.record(runId, { type: 'approval_resolved', id, allowed })
      return allowed
    }
  }

  private askUser(runId: string, signal: AbortSignal): NonNullable<AdapterRunOptions['askUser']> {
    return async ({ text, options }) => {
      const id = randomUUID()
      this.record(runId, { type: 'question', id, text, ...(options?.length ? { options } : {}) })
      const answer = await new Promise<string | null>(resolve => {
        if (signal.aborted) return resolve(null)
        this.questions.set(id, resolve)
        signal.addEventListener('abort', () => resolve(null), { once: true })
      })
      this.questions.delete(id)
      this.record(runId, { type: 'question_answered', id, answer })
      return answer
    }
  }

  /**
   * Spec custos-e-perfis §5: a ferramenta passou do limite. Cada run trabalhando nela recebe um aviso (só um por run),
   * com o substituto sugerido — ou sem destino, se ninguém tem folga.
   */
  async warnLimit(tool: ToolKind, window: WindowKind, utilization: number, pick: (from: AgentId) => Promise<AgentId | undefined>): Promise<void> {
    for (const runId of this.executing) {
      const run = this.deps.store.getRun(runId)
      if (!run || run.status !== 'running' || getAgent(run.agentId).tool !== tool || this.warned.has(`${runId}:${tool}`) || this.delivered.has(runId)) continue
      this.warned.add(`${runId}:${tool}`)
      const to = await pick(run.agentId)
      if (!this.executing.has(runId) || this.delivered.has(runId)) continue
      const id = randomUUID()
      this.warnings.set(id, { runId, ...(to ? { to } : {}) })
      // Destino por API paga: o aviso diz isso antes do [Passar] (spec custos-e-perfis §10).
      const target = to ? getAgent(to) : undefined
      const paid = target?.transport.kind === 'api' ? { provider: providerName(target.transport.provider) } : undefined
      this.record(runId, { type: 'limit_warning', id, tool, window, utilization, ...(to ? { to } : {}), ...(paid ? { paid } : {}) })
    }
  }

  /** Resposta do Natan ao aviso: Passar (troca de agente, mantendo o que já foi feito) ou Continuar. */
  async respondLimit(warningId: string, pass: boolean): Promise<void> {
    const w = this.warnings.get(warningId)
    if (!w) return
    this.warnings.delete(warningId)
    const run = this.deps.store.getRun(w.runId)
    const doPass = pass && !!w.to && run?.status === 'running'
    this.record(w.runId, { type: 'limit_resolved', id: warningId, pass: doPass })
    if (!doPass || !run || !w.to) return
    const from = getAgent(run.agentId)
    const files = [...new Set(this.deps.store.listEvents(run.id).flatMap(e => (e.type === 'file_changed' ? [e.path] : [])))]
    const prompt = [
      run.prompt,
      `Você está assumindo o trabalho do ${from.nome}, que parou no limite da assinatura.`,
      files.length ? `Arquivos que ele já alterou: ${files.join(', ')}.` : 'Ele ainda não tinha alterado arquivos.',
      'Continue de onde ele parou; não desfaça o que já foi feito sem motivo.',
    ].join('\n\n')
    const projectPath = this.deps.store.projectPathForRun(run.id)!
    let resolveNew!: (id: string) => void
    const newIdPromise = new Promise<string>(r => { resolveNew = r })
    // O pai do time precisa saber da troca antes de ver o filho antigo terminar cancelado.
    if (run.parentRunId) this.onChildHandoff?.(run.parentRunId, run.id, newIdPromise, w.to)
    this.cancel(run.id)
    await this.whenFinished(run.id)
    const base = { projectPath, conversationId: run.conversationId, agentId: w.to, prompt }
    let newRunId: string
    try {
      newRunId = run.parentRunId ? await this.startChild({ ...base, parentRunId: run.parentRunId }) : await this.start(base)
    } catch (e) {
      // Sem substituto o original fica cancelado; o pai do time segue com ele como resultado final.
      resolveNew(run.id)
      const why = e instanceof Error && e.message === 'TOOL_UNAVAILABLE' ? 'não está disponível' : 'não conseguiu começar'
      this.record(run.id, { type: 'notice', text: `Não consegui passar o trabalho: o ${getAgent(w.to).nome} ${why}.` })
      return
    }
    resolveNew(newRunId)
    this.record(run.id, { type: 'handoff', to: w.to, newRunId })
  }

  /**
   * Uma consulta avulsa (só leitura) a um agente: junta os textos e registra o uso em `usageRunId`.
   * Lança `AGENT_UNAVAILABLE` se o agente não pode trabalhar agora, `CANCELED` se o sinal abortar, `TIMEOUT` se o prazo estourar e `AGENT_ERROR` se o agente só devolveu erro.
   */
  async consultOnce(i: { usageRunId: string; agentId: AgentId; prompt: string; cwd: string; instructions?: string; signal: AbortSignal; timeoutMs?: number }): Promise<string> {
    const agent = getAgent(i.agentId)
    const adapter = this.deps.adapters[agent.tool]
    if (!adapter || !(await this.availability(i.agentId)).ok) throw new Error('AGENT_UNAVAILABLE')
    if (i.signal.aborted) throw new Error('CANCELED')
    const ctl = new AbortController()
    const onParent = () => ctl.abort()
    i.signal.addEventListener('abort', onParent, { once: true })
    let timedOut = false
    const timer = i.timeoutMs ? setTimeout(() => { timedOut = true; ctl.abort() }, i.timeoutMs) : undefined
    const stopped = () => new Error(timedOut ? 'TIMEOUT' : 'CANCELED')
    const texts: string[] = []
    let failed = false
    try {
      const model = effectiveModel(agent)
      for await (const ev of adapter.run({
        agent, prompt: i.prompt, cwd: i.cwd, instructions: i.instructions ?? '', signal: ctl.signal, mode: 'consult',
        requestApproval: async () => false, ...(model ? { model } : {}),
      })) {
        if (ev.type === 'text') texts.push(ev.text)
        if (ev.type === 'error') failed = true
        if (ev.type === 'usage' || ev.type === 'limit') this.recordUsage(i.usageRunId, agent.id, ev)
      }
    } catch (e) {
      if (ctl.signal.aborted) throw stopped()
      throw e
    } finally {
      clearTimeout(timer)
      i.signal.removeEventListener('abort', onParent)
    }
    if (ctl.signal.aborted) throw stopped()
    // Erro do agente (limite, autenticação…) sem nenhum texto: não é "resposta vazia".
    if (failed && !texts.length) throw new Error('AGENT_ERROR')
    return texts.join('\n\n')
  }

  /** Spec §5.4: pergunta ao Radar/Lupa em modo consulta, sem repassar a ferramenta (profundidade 1). */
  private askAgent(runId: string, from: StartRunInput['agentId'], cwd: string, signal: AbortSignal): NonNullable<AdapterRunOptions['askAgent']> {
    return async (to, question) => {
      const agent = getAgent(to)
      // Só quem o perfil marca como "pode ser consultado" (o modelo pode inventar um id).
      if (!consultableFor(getAgent(from)).some(a => a.id === to)) return `Não há ninguém com o id ${to} para consultar.`
      this.record(runId, { type: 'agent_call', from, to, question })
      let answer: string
      try {
        answer = (await this.consultOnce({ usageRunId: runId, agentId: to, prompt: question, cwd, signal, timeoutMs: 120_000 })) || `O ${agent.nome} não respondeu a tempo.`
      } catch (e) {
        // falha do chamado vira "não respondeu" para quem perguntou
        answer = e instanceof Error && e.message === 'AGENT_UNAVAILABLE' ? `O ${agent.nome} não está disponível.` : `O ${agent.nome} não respondeu a tempo.`
      }
      this.record(runId, { type: 'agent_call_answer', from, to, answer })
      return answer
    }
  }

  private async execute(runId: string, input: StartRunInput, adapter: AgentAdapter, signal: AbortSignal, withCheckpoint: boolean): Promise<void> {
    let status: RunStatus = 'done'
    let sessionId: string | undefined
    this.executing.add(runId)
    try {
      const loaded = await loadInstructions(input.projectPath, this.deps.homeDir)
      if (signal.aborted) return
      const agent = getAgent(input.agentId)
      // Skills (plano skills, Design §6): Claude CLI por plugin local; as outras ferramentas nas instruções. Consulta não recebe.
      const skills = input.mode === 'consult' ? [] : this.deps.skillsFor?.(agent.id) ?? []
      const byPlugin = skills.length > 0 && agent.transport.kind === 'cli' && agent.tool === 'claude' && !!this.deps.skillPluginDir
      const skillPlugin = byPlugin ? writeClaudePlugin(this.deps.skillPluginDir!(agent.id), skills) : undefined
      const instructions = byPlugin ? loaded : [loaded, skillsInstructions(skills)].filter(Boolean).join('\n\n')
      // Autonomia (design §4): lida a cada permissão; o sandbox do Sozinho é decidido no começo do pedido, só para Claude CLI.
      const autonomy = (): AutonomyLevel => this.deps.autonomyFor?.(input.projectPath) ?? DEFAULT_AUTONOMY
      const claudeCli = agent.transport.kind === 'cli' && agent.tool === 'claude'
      const wantsSandbox = input.mode !== 'consult' && claudeCli && autonomy() === 'autonomous'
      const sandbox = wantsSandbox && (this.deps.sandboxAvailable?.() ?? true)
      if (wantsSandbox && !sandbox) this.record(runId, { type: 'notice', text: 'Sozinho indisponível: usando Aceitar edições.' })
      // Spec §5.7.1: o agente retoma a própria sessão nesta conversa; se a CLI já não a reconhece, começa outra uma vez.
      let resume = this.deps.store.lastSessionFor(input.conversationId, agent.id, agentSignature(agent)) ?? undefined
      // Agente por API usa sempre o modelo do perfil (o modelo escolhido no pedido é da lista das CLIs).
      const model = effectiveModel(agent, input.model)
      const consultable = consultableFor(agent)
      // Contexto compartilhado: o que o Natan e os outros já disseram nesta conversa (consulta não recebe, por economia).
      const shared = (resumed: boolean) => {
        if (input.mode === 'consult') return ''
        const entries = collectEntries(this.deps.store, input.conversationId, runId)
        const lastOwn = resumed ? entries.filter(e => e.who === agent.id).at(-1)?.at : undefined
        return buildContext(entries, { forAgent: agent.id, ...(lastOwn !== undefined ? { sinceAt: lastOwn } : {}) })
      }
      for (;;) {
        const prefix = shared(!!resume)
        let started = false
        let staleSession = false
        const events = adapter.run({
          agent, prompt: prefix ? `${prefix}\n\n${input.prompt}` : input.prompt, cwd: input.projectPath, instructions, signal, resumeSessionId: resume,
          ...(model ? { model } : {}), ...(input.mode ? { mode: input.mode } : {}),
          requestApproval: this.requestApproval(runId, signal), askUser: this.askUser(runId, signal), ...(skillPlugin ? { skillPlugin } : {}),
          autonomy, ...(sandbox ? { sandbox } : {}), ...(claudeCli && input.mode !== 'consult' && this.deps.browser ? { browser: this.deps.browser } : {}),
          ...(input.mode !== 'consult' && consultable.length ? { askAgent: this.askAgent(runId, agent.id, input.projectPath, signal), consultable } : {}),
        })
        try {
          for await (let ev of events) {
            if (ev.type === 'usage' || ev.type === 'limit') {
              if (ev.type === 'usage') this.delivered.add(runId)
              this.recordUsage(runId, agent.id, ev)
              continue
            }
            if (!started && resume && ev.type === 'error' && looksLikeStaleSession(ev.message)) { staleSession = true; break }
            started = true
            if (ev.type === 'done') { sessionId = ev.sessionId; this.delivered.add(runId) }
            if (ev.type === 'error') status = 'error'
            this.record(runId, ev)
          }
        } catch (e) {
          if (started || !resume || !looksLikeStaleSession(String(e))) throw e
          staleSession = true
        }
        if (!staleSession || signal.aborted) break
        this.record(runId, { type: 'notice', text: `Não consegui retomar a conversa anterior do ${agent.nome}; comecei uma nova.` })
        resume = undefined
      }
    } catch (e) {
      if (!signal.aborted) {
        status = 'error'
        this.record(runId, { type: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    } finally {
      this.executing.delete(runId)
      this.delivered.delete(runId)
      for (const k of this.warned) if (k.startsWith(`${runId}:`)) this.warned.delete(k)
      // Pedido acabou antes da resposta ao aviso: não há mais o que passar.
      for (const [id, w] of this.warnings) {
        if (w.runId !== runId) continue
        this.warnings.delete(id)
        this.record(runId, { type: 'limit_resolved', id, pass: false })
      }
      if (signal.aborted) status = 'cancelled'
      if (withCheckpoint && !(await this.finalDiff(runId, input.projectPath))) status = 'error'
      this.close(runId, status, sessionId)
    }
  }

  /** Grava o ponto final e emite o diff do pedido; false se não conseguiu. */
  async finalDiff(runId: string, projectPath: string): Promise<boolean> {
    const { before, after } = refs(runId)
    try {
      await snapshot(projectPath, after)
      this.record(runId, { type: 'diff', files: await diffBetween(projectPath, before, after) })
      return true
    } catch (e) {
      this.record(runId, { type: 'error', message: `Não consegui gravar o ponto final: ${e instanceof Error ? e.message : String(e)}` })
      return false
    }
  }

  async snapshotBefore(runId: string, projectPath: string): Promise<void> {
    await snapshot(projectPath, refs(runId).before)
  }
}
