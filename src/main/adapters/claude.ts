import { query, type CanUseTool, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { homedir } from 'node:os'
import type { AgentEvent } from '@shared/events'
import type { LimitWindow, WindowKind } from '@shared/usage'
import { classifyToolCall, decide, summarizeToolCall } from '../policy/commandPolicy'
import { join } from 'node:path'
import { AGENT_CALL_TOOL, makeAgentCallTool } from '../team/agentCalls'
import { safeEnv } from './env'
import { systemAppend, type AdapterRunOptions, type AgentAdapter } from './types'

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** Partes do .git que mudam o que o git executa (hooks, filtros, outro repositório comum). */
const GIT_PROTECTED = ['.git/hooks', '.git/config', '.git/config.worktree', '.git/commondir', '.git/info']
/** Credenciais na home que nenhum comando do Sozinho precisa ler. */
const HOME_SECRETS = ['.ssh', '.aws', '.gnupg', '.config/gh', '.netrc', 'Library/Keychains', '.docker', '.kube']
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
    settingSources: [], strictMcpConfig: true,
    plugins: opts.skillPlugin ? [{ type: 'local', path: opts.skillPlugin.path }] : [], skills: opts.skillPlugin?.names ?? [],
    mcpServers: opts.askAgent && opts.mode !== 'consult' ? { tutti: makeAgentCallTool(opts.askAgent, opts.consultable) } : {},
    permissionMode: 'default',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend(opts.agent, opts.instructions) },
    canUseTool,
    // Sozinho: escrita só no projeto, fora de .git/hooks e .git/config; falha alto se o sandbox não subir (spike-sandbox).
    // O modelo não pode pedir para sair do sandbox (allowUnsandboxedCommands); segredos da home ficam ilegíveis.
    ...(opts.sandbox ? { sandbox: {
      enabled: true, autoAllowBashIfSandboxed: false, failIfUnavailable: true, allowUnsandboxedCommands: false,
      filesystem: {
        allowWrite: [opts.cwd],
        denyWrite: GIT_PROTECTED.map(p => join(opts.cwd, p)),
        denyRead: HOME_SECRETS.map(p => join(homedir(), p)),
      },
    } } : {}),
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
    // Sozinho sem a barreira do sandbox age como Aceitar edições (design §4.1.1).
    const level = opts.autonomy?.() ?? 'accept_edits'
    // Comando que pede para rodar fora do sandbox não conta como protegido por ele.
    const sandboxed = !!opts.sandbox && (input as { dangerouslyDisableSandbox?: unknown }).dangerouslyDisableSandbox !== true
    const r = decide(call, opts.cwd, { level: level === 'autonomous' && !sandboxed ? 'accept_edits' : level, sandboxed })
    if (r.decision === 'allow') return { behavior: 'allow', updatedInput: input }
    const allowed = await opts.requestApproval({ toolName, summary: summarizeToolCall(call, opts.cwd), ...(r.reason ? { reason: r.reason } : {}) })
    return allowed ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Natan negou este comando.' }
  }
}

/**
 * Uso do plano sem gastar pedido: sessão com entrada em stream que nunca manda mensagem + consulta de uso
 * (experimental no SDK — qualquer falha vira "sem dado"). Spike de uso.
 */
export async function pollClaudeUsage(queryFn: typeof query = query, now = Date.now, timeoutMs = 15_000): Promise<LimitWindow[]> {
  let release: (() => void) | undefined
  const idle = (async function* () { await new Promise<void>(r => { release = r }) })() as AsyncIterable<never>
  const abortController = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const q = queryFn({ prompt: idle, options: { abortController, cwd: homedir(), env: safeEnv(dropEnv), settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [], skills: [] } })
  try {
    // API experimental: se não responder no prazo, desiste e encerra o processo ocioso.
    const u = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs) }),
    ])
    if (!u.rate_limits_available || !u.rate_limits) return []
    const at = now()
    return (Object.entries(u.rate_limits) as [string, { utilization: number | null; resets_at: string | null } | null][])
      .flatMap(([k, w]) => (WINDOW[k] && w && typeof w.utilization === 'number'
        ? [{ tool: 'claude' as const, window: WINDOW[k], utilization: Math.round(w.utilization), ...(w.resets_at ? { resetsAt: Date.parse(w.resets_at) } : {}), at }]
        : []))
  } catch {
    return []
  } finally {
    clearTimeout(timer)
    release?.()
    void q.interrupt?.().catch(() => {})
    abortController.abort()
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
