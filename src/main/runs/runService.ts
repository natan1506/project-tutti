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
}

const refs = (runId: string) => ({ before: `refs/time/runs/${runId}/before`, after: `refs/time/runs/${runId}/after` })

/** Ciclo de vida de um pedido a um agente: ponto de restauração → agente → diff → fim. */
export class RunService {
  private controllers = new Map<string, AbortController>()
  private approvals = new Map<string, (allowed: boolean) => void>()
  private finished = new Map<string, Promise<void>>()

  constructor(private deps: Deps) {}

  async start(input: StartRunInput): Promise<string> {
    const agent = getAgent(input.agentId)
    const adapter = this.deps.adapters[agent.tool]
    if (agent.availableInPhase !== 1 || !adapter) throw new Error('AGENT_NOT_AVAILABLE')
    if (!(await isGitRepo(input.projectPath))) throw new Error('NOT_A_GIT_REPO')

    const runId = randomUUID()
    await snapshot(input.projectPath, refs(runId).before)
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

  recover(): void {
    this.deps.store.markInterruptedRuns()
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

  private async execute(runId: string, input: StartRunInput, adapter: AgentAdapter, signal: AbortSignal): Promise<void> {
    let status: RunStatus = 'done'
    let sessionId: string | undefined
    try {
      const instructions = await loadInstructions(input.projectPath, this.deps.homeDir)
      const events = adapter.run({
        agent: getAgent(input.agentId), prompt: input.prompt, cwd: input.projectPath, instructions, signal,
        requestApproval: this.requestApproval(runId, signal),
      })
      for await (const ev of events) {
        if (ev.type === 'done') sessionId = ev.sessionId
        if (ev.type === 'error') status = 'error'
        this.record(runId, ev)
      }
    } catch (e) {
      if (!signal.aborted) {
        status = 'error'
        this.record(runId, { type: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    } finally {
      if (signal.aborted) status = 'cancelled'
      const { before, after } = refs(runId)
      await snapshot(input.projectPath, after)
      this.record(runId, { type: 'diff', files: await diffBetween(input.projectPath, before, after) })
      this.record(runId, { type: 'run_finished', status })
      this.deps.store.finishRun(runId, status, sessionId)
      this.controllers.delete(runId)
    }
  }
}
