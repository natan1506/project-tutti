import { query, type CanUseTool, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '@shared/events'
import { classifyToolCall, summarizeToolCall } from '../policy/commandPolicy'
import { safeEnv } from './env'
import { systemAppend, type AdapterRunOptions, type AgentAdapter } from './types'

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const CONSULT_BLOCKED = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'Task']
const CONSULT_ALLOWED = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite'])
// Além das chaves de API (env.ts), tira as variáveis herdadas de uma sessão do Claude Code que esteja rodando o app.
const dropEnv = (k: string) => k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')

export function buildClaudeOptions(opts: AdapterRunOptions, canUseTool: CanUseTool): Options {
  return {
    cwd: opts.cwd,
    model: opts.model ?? opts.agent.defaultModel,
    resume: opts.resumeSessionId,
    env: safeEnv(dropEnv),
    settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [], skills: [],
    permissionMode: 'default',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend(opts.agent, opts.instructions) },
    canUseTool,
    ...(opts.mode === 'consult' ? { disallowedTools: CONSULT_BLOCKED } : {}),
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

interface AskInput { questions?: { question: string; options?: { label: string }[] }[] }
const NO_ANSWER = 'O Natan não respondeu; siga com a opção mais sensata e registre a suposição.'

export function makeCanUseTool(opts: AdapterRunOptions): CanUseTool {
  return async (toolName, input) => {
    if (opts.mode === 'consult') {
      // Consulta nunca altera nada nem pergunta ao Natan: só leitura dentro do projeto.
      return CONSULT_ALLOWED.has(toolName) && classifyToolCall({ toolName, input }, opts.cwd) === 'allow'
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'Modo consulta: só leitura.' }
    }
    if (toolName === 'AskUserQuestion') {
      const answers: Record<string, string> = {}
      for (const q of (input as AskInput).questions ?? []) {
        const answer = await opts.askUser?.({ text: q.question, options: q.options?.map(o => o.label) })
        if (answer == null) return { behavior: 'deny', message: NO_ANSWER }
        answers[q.question] = answer
      }
      return { behavior: 'allow', updatedInput: { ...input, answers } }
    }
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
    if (opts.signal.aborted) onAbort()
    opts.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const q = query({ prompt: opts.prompt, options: { ...buildClaudeOptions(opts, makeCanUseTool(opts)), abortController } })
      for await (const msg of q) yield* mapClaudeMessage(msg, opts.cwd)
    } finally {
      opts.signal.removeEventListener('abort', onAbort)
    }
  }
}
