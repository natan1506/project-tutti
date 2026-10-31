import { query, type CanUseTool, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '@shared/events'
import { classifyToolCall, summarizeToolCall } from '../policy/commandPolicy'
import { childEnv, systemAppend, type AdapterRunOptions, type AgentAdapter } from './types'

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const dropEnv = (k: string) => k === 'ANTHROPIC_API_KEY' || k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')

export function buildClaudeOptions(opts: AdapterRunOptions, canUseTool: CanUseTool): Options {
  return {
    cwd: opts.cwd,
    model: opts.model ?? opts.agent.defaultModel,
    resume: opts.resumeSessionId,
    env: childEnv(dropEnv),
    settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [], skills: [],
    permissionMode: 'default',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend(opts.agent, opts.instructions) },
    canUseTool,
  }
}

export function mapClaudeMessage(msg: SDKMessage, cwd: string): AgentEvent[] {
  if (msg.type === 'assistant') {
    const out: AgentEvent[] = []
    for (const block of msg.message.content) {
      if (block.type === 'text') out.push({ type: 'text', text: block.text })
      else if (block.type === 'tool_use') {
        const call = { toolName: block.name, input: block.input as Record<string, unknown> }
        const summary = summarizeToolCall(call, cwd)
        out.push({ type: 'tool', name: block.name, summary })
        if (FILE_TOOLS.has(block.name)) out.push({ type: 'file_changed', path: summary })
      }
    }
    return out
  }
  if (msg.type === 'result') {
    if (!msg.is_error && msg.subtype === 'success') return [{ type: 'done', sessionId: msg.session_id }]
    const errors = 'errors' in msg && Array.isArray(msg.errors) ? msg.errors.join('\n') : ''
    return [{ type: 'error', message: errors || ('result' in msg && typeof msg.result === 'string' ? msg.result : msg.subtype) }]
  }
  return []
}

export function makeCanUseTool(opts: AdapterRunOptions): CanUseTool {
  return async (toolName, input) => {
    const call = { toolName, input }
    if (classifyToolCall(call, opts.cwd) === 'allow') return { behavior: 'allow', updatedInput: input }
    const allowed = await opts.requestApproval({ toolName, summary: summarizeToolCall(call, opts.cwd) })
    return allowed ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Natan negou este comando.' }
  }
}

export class ClaudeAdapter implements AgentAdapter {
  async *run(opts: AdapterRunOptions): AsyncIterable<AgentEvent> {
    const abortController = new AbortController()
    const onAbort = () => abortController.abort()
    opts.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const q = query({ prompt: opts.prompt, options: { ...buildClaudeOptions(opts, makeCanUseTool(opts)), abortController } })
      for await (const msg of q) yield* mapClaudeMessage(msg, opts.cwd)
    } finally {
      opts.signal.removeEventListener('abort', onAbort)
    }
  }
}
