import { query, type CanUseTool, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '@shared/events'
import type { LimitWindow, WindowKind } from '@shared/usage'
import { classifyToolCall, summarizeToolCall } from '../policy/commandPolicy'
import { AGENT_CALL_TOOL, makeAgentCallTool } from '../team/agentCalls'
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
    settingSources: [], strictMcpConfig: true, plugins: [], skills: [],
    mcpServers: opts.askAgent && opts.mode !== 'consult' ? { tutti: makeAgentCallTool(opts.askAgent) } : {},
    permissionMode: 'default',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend(opts.agent, opts.instructions) },
    canUseTool,
    ...(opts.mode === 'consult' ? { disallowedTools: CONSULT_BLOCKED } : {}),
  }
}

const WINDOW: Record<string, WindowKind> = { five_hour: 'five_hour', seven_day: 'seven_day', seven_day_opus: 'seven_day_model', seven_day_sonnet: 'seven_day_model' }

/** `rate_limit_event`: uma entrada por janela (unifiedWindows), utilização 0–1 → 0–100, reset em segundos → ms. */
export function limitsFromRateEvent(info: Record<string, unknown>, at: number): LimitWindow[] {
  const one = (name: string, w: { utilization?: number; resetsAt?: number }): LimitWindow[] =>
    WINDOW[name] && typeof w.utilization === 'number'
      ? [{ tool: 'claude', window: WINDOW[name], utilization: Math.round(w.utilization * 100), ...(w.resetsAt ? { resetsAt: w.resetsAt * 1000 } : {}), at }]
      : []
  const unified = info.unifiedWindows as Record<string, { utilization?: number; resetsAt?: number }> | undefined
  if (unified) return Object.entries(unified).flatMap(([k, w]) => one(k, w))
  return one(String(info.rateLimitType), info as { utilization?: number; resetsAt?: number })
}

export function mapClaudeMessage(msg: SDKMessage, cwd: string): AgentEvent[] {
  if (msg.type === 'rate_limit_event') {
    return limitsFromRateEvent(msg.rate_limit_info as unknown as Record<string, unknown>, Date.now()).map(limit => ({ type: 'limit' as const, limit }))
  }
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
    const u = (msg as unknown as { usage?: Record<string, number> & { output_tokens_details?: { thinking_tokens?: number } } }).usage
    const usage: AgentEvent[] = u && typeof u.input_tokens === 'number'
      ? [{ type: 'usage', tool: 'claude', tokens: {
        input: u.input_tokens + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0, reasoning: u.output_tokens_details?.thinking_tokens ?? 0,
      } }]
      : []
    if (!msg.is_error && msg.subtype === 'success') return [...usage, { type: 'done', sessionId: msg.session_id }]
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
    // A ferramenta do app é carregada sob demanda: o Claude Code passa por ToolSearch antes (spike da Fase 3B).
    if (opts.askAgent && (toolName === AGENT_CALL_TOOL || toolName === 'ToolSearch')) return { behavior: 'allow', updatedInput: input }
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
