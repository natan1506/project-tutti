import { randomUUID } from 'node:crypto'
import { getAgent, type ToolKind } from '@shared/agents'
import type { RunEvent, RunStatus } from '@shared/events'
import type { StartRunInput } from '@shared/models'
import type { AdapterRunOptions, AgentAdapter } from '../adapters/types'
import { diffBetween, patchBetween, snapshot, undo, type UndoResult } from '../git/checkpoint'
import { isGitRepo, runGit } from '../git/git'
import { loadInstructions } from '../instructions/loadInstructions'
import type { Store } from '../store/db'


interface Deps {
  store: Store
  adapters: Record<ToolKind, AgentAdapter | undefined>
  emit: (runId: string, ev: RunEvent) => void
  homeDir?: string
  /** Ferramenta instalada e logada? (padrão: sim) */
  toolReady?: (tool: ToolKind) => Promise<boolean>
}

const refs = (runId: string) => ({ before: `refs/time/runs/${runId}/before`, after: `refs/time/runs/${runId}/after` })

/** Ciclo de vida de um pedido a um agente: ponto de restauração → agente → diff → fim. */
export class RunService {
  private controllers = new Map<string, AbortController>()
  private approvals = new Map<string, (allowed: boolean) => void>()
  private questions = new Map<string, (answer: string | null) => void>()
  private finished = new Map<string, Promise<void>>()
  private busyProjects = new Set<string>()

  constructor(private deps: Deps) {}

  async start(input: StartRunInput): Promise<string> {
    const agent = getAgent(input.agentId)
    const adapter = this.deps.adapters[agent.tool]
    if (!adapter || !(await (this.deps.toolReady?.(agent.tool) ?? true))) throw new Error('TOOL_UNAVAILABLE')
    if (!(await isGitRepo(input.projectPath))) throw new Error('NOT_A_GIT_REPO')
    // Spec §6.2: um pedido por vez por projeto (a fila chega na Fase 3B).
    if (this.busyProjects.has(input.projectPath)) throw new Error('PROJECT_BUSY')
    this.busyProjects.add(input.projectPath)

    const runId = randomUUID()
    try {
      await snapshot(input.projectPath, refs(runId).before)
    } catch (e) {
      this.busyProjects.delete(input.projectPath)
      throw e
    }
    this.deps.store.createRun({ id: runId, conversationId: input.conversationId, agentId: agent.id, prompt: input.prompt, startedAt: Date.now(), hasCheckpoint: true })
    this.record(runId, { type: 'run_started', runId, agentId: agent.id })

    const controller = new AbortController()
    this.controllers.set(runId, controller)
    this.finished.set(runId, this.execute(runId, input, adapter, controller.signal))
    return runId
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

  private record(runId: string, ev: RunEvent): void {
    this.deps.store.appendEvent(runId, ev)
    this.deps.emit(runId, ev)
  }

  private requestApproval(runId: string, signal: AbortSignal): AdapterRunOptions['requestApproval'] {
    return async ({ toolName, summary }) => {
      const id = randomUUID()
      this.record(runId, { type: 'approval_request', id, toolName, summary })
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

  private async execute(runId: string, input: StartRunInput, adapter: AgentAdapter, signal: AbortSignal): Promise<void> {
    let status: RunStatus = 'done'
    let sessionId: string | undefined
    try {
      const instructions = await loadInstructions(input.projectPath, this.deps.homeDir)
      if (signal.aborted) return
      const agent = getAgent(input.agentId)
      // Spec §5.7.1: o agente retoma a própria sessão nesta conversa; se a CLI já não a reconhece, começa outra uma vez.
      let resume = this.deps.store.lastSessionFor(input.conversationId, agent.id) ?? undefined
      for (;;) {
        let started = false
        let staleSession = false
        const events = adapter.run({
          agent, prompt: input.prompt, cwd: input.projectPath, instructions, signal, resumeSessionId: resume,
          requestApproval: this.requestApproval(runId, signal), askUser: this.askUser(runId, signal),
        })
        for await (const ev of events) {
          if (!started && resume && ev.type === 'error') { staleSession = true; break }
          started = true
          if (ev.type === 'done') sessionId = ev.sessionId
          if (ev.type === 'error') status = 'error'
          this.record(runId, ev)
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
      if (signal.aborted) status = 'cancelled'
      const { before, after } = refs(runId)
      try {
        await snapshot(input.projectPath, after)
        this.record(runId, { type: 'diff', files: await diffBetween(input.projectPath, before, after) })
      } catch (e) {
        status = 'error'
        this.record(runId, { type: 'error', message: `Não consegui gravar o ponto final: ${e instanceof Error ? e.message : String(e)}` })
      }
      this.record(runId, { type: 'run_finished', status })
      this.deps.store.finishRun(runId, status, sessionId)
      this.controllers.delete(runId)
      this.busyProjects.delete(input.projectPath)
    }
  }
}
