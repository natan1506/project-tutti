import { Codex, type ThreadEvent, type ThreadOptions } from '@openai/codex-sdk'
import type { AgentEvent } from '@shared/events'
import { summarizeToolCall } from '../policy/commandPolicy'
import { childEnv, systemAppend, type AdapterRunOptions, type AgentAdapter } from './types'

// O SDK do Codex não permite interceptar comandos: o Lupa roda sempre em sandbox só-leitura.

export function buildCodexThreadOptions(opts: AdapterRunOptions): ThreadOptions {
  return {
    sandboxMode: 'read-only', approvalPolicy: 'never', workingDirectory: opts.cwd, skipGitRepoCheck: true,
    ...(opts.model ? { model: opts.model } : {}),
  }
}

export function buildCodexPrompt(opts: AdapterRunOptions): string {
  return [systemAppend(opts.agent, opts.instructions), opts.prompt].join('\n\n')
}

export function unwrapShell(command: string): string {
  const m = command.match(/^\S*\/(?:zsh|bash|sh) -lc (['"])([\s\S]*)\1$/)
  return m ? m[2] : command
}

export function mapCodexEvent(ev: ThreadEvent, cwd: string, state: { threadId?: string }): AgentEvent[] {
  switch (ev.type) {
    case 'thread.started':
      state.threadId = ev.thread_id
      return []
    case 'item.started':
      return ev.item.type === 'command_execution' ? [{ type: 'tool', name: 'Shell', summary: unwrapShell(ev.item.command) }] : []
    case 'item.completed':
      if (ev.item.type === 'agent_message') return [{ type: 'text', text: ev.item.text }]
      if (ev.item.type === 'file_change') {
        return ev.item.changes.map(c => ({ type: 'file_changed', path: summarizeToolCall({ toolName: 'Edit', input: { file_path: c.path } }, cwd) }))
      }
      return []
    case 'turn.completed':
      return [{ type: 'done', sessionId: state.threadId }]
    case 'turn.failed':
      return [{ type: 'error', message: ev.error.message }]
    case 'error':
      return [{ type: 'error', message: ev.message }]
    default:
      return []
  }
}

export class CodexAdapter implements AgentAdapter {
  async *run(opts: AdapterRunOptions): AsyncIterable<AgentEvent> {
    const codex = new Codex({ env: childEnv(k => k === 'OPENAI_API_KEY'), config: { mcp_servers: {} } })
    const threadOptions = buildCodexThreadOptions(opts)
    const thread = opts.resumeSessionId ? codex.resumeThread(opts.resumeSessionId, threadOptions) : codex.startThread(threadOptions)
    const state: { threadId?: string } = { threadId: opts.resumeSessionId }
    const { events } = await thread.runStreamed(buildCodexPrompt(opts), { signal: opts.signal })
    for await (const ev of events) yield* mapCodexEvent(ev, opts.cwd, state)
  }
}
