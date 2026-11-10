import { Codex, type ThreadEvent, type ThreadOptions } from '@openai/codex-sdk'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent } from '@shared/events'
import type { LimitWindow } from '@shared/usage'
import { summarizeToolCall } from '../policy/commandPolicy'
import { safeEnv } from './env'
import { executableFor } from './executables'
import { systemAppend, type AdapterRunOptions, type AgentAdapter } from './types'

// O SDK do Codex não permite interceptar comandos: roda em sandbox só-leitura, exceto num passo da esteira (`write`),
// em que escreve só dentro da pasta do projeto e sem rede (cerca do próprio Codex).

export function buildCodexThreadOptions(opts: AdapterRunOptions): ThreadOptions {
  const write = opts.write === true && opts.mode !== 'consult'
  return {
    sandboxMode: write ? 'workspace-write' : 'read-only', approvalPolicy: 'never', workingDirectory: opts.cwd, skipGitRepoCheck: true,
    ...(write ? { networkAccessEnabled: false } : {}),
    ...(opts.model ? { model: opts.model } : {}),
  }
}

/** MCPs do Codex (spec mcps §3): só as ferramentas de leitura, pela lista `enabled_tools` do próprio Codex. */
export function buildCodexConfig(opts: AdapterRunOptions): { mcp_servers: Record<string, Record<string, unknown>> } {
  const list = opts.mode === 'consult' ? [] : opts.mcp ?? []
  return { mcp_servers: Object.fromEntries(list.map(m => [m.nome, m.launch.kind === 'http'
    ? { url: m.launch.url, enabled_tools: m.read }
    : { command: m.launch.command, args: m.launch.args, env: m.launch.env, enabled_tools: m.read }])) }
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
    case 'turn.completed': {
      const u = ev.usage as { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number } | null
      const usage: AgentEvent[] = u && typeof u.input_tokens === 'number'
        ? [{ type: 'usage', tool: 'codex', tokens: {
          input: u.input_tokens - (u.cached_input_tokens ?? 0), output: u.output_tokens ?? 0,
          cacheRead: u.cached_input_tokens ?? 0, reasoning: u.reasoning_output_tokens ?? 0,
        } }]
        : []
      return [...usage, { type: 'done', sessionId: state.threadId }]
    }
    case 'turn.failed':
      return [{ type: 'error', message: ev.error.message }]
    case 'error':
      return [{ type: 'error', message: ev.message }]
    default:
      return []
  }
}

/** Procura `rate_limits` em qualquer nível de um objeto do log. */
function findRateLimits(v: unknown): Record<string, { used_percent?: number; window_minutes?: number; resets_at?: number }> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (o.rate_limits && typeof o.rate_limits === 'object') return o.rate_limits as never
  for (const x of Object.values(o)) { const f = findRateLimits(x); if (f) return f }
  return undefined
}

/**
 * O SDK do Codex não expõe o limite; o CLI grava no log da thread (spike de uso).
 * `primary` = janela de 5 h, `secondary` = semanal. Usa a última ocorrência.
 */
export function codexLimitsFromLog(text: string, at: number): LimitWindow[] {
  let last: ReturnType<typeof findRateLimits>
  for (const line of text.split('\n')) {
    if (!line.includes('rate_limits')) continue
    try { last = findRateLimits(JSON.parse(line)) ?? last } catch { /* linha quebrada */ }
  }
  if (!last) return []
  const out: LimitWindow[] = []
  for (const [key, window] of [['primary', 'five_hour'], ['secondary', 'seven_day']] as const) {
    const w = last[key]
    if (w && typeof w.used_percent === 'number') out.push({ tool: 'codex', window, utilization: Math.round(w.used_percent), ...(w.resets_at ? { resetsAt: w.resets_at * 1000 } : {}), at })
  }
  return out
}

/** Arquivo `rollout-…-<threadId>.jsonl` mais recente em ~/.codex/sessions/AAAA/MM/DD. */
export function findRolloutFile(threadId: string, root = join(homedir(), '.codex/sessions')): string | undefined {
  if (!existsSync(root)) return undefined
  const found: string[] = []
  const walk = (dir: string, depth: number) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (depth < 3 && statSync(p).isDirectory()) walk(p, depth + 1)
      else if (name.endsWith(`${threadId}.jsonl`)) found.push(p)
    }
  }
  walk(root, 0)
  return found.sort().at(-1)
}

export function codexEnv(): Record<string, string> {
  return safeEnv()
}

export class CodexAdapter implements AgentAdapter {
  async *run(opts: AdapterRunOptions): AsyncIterable<AgentEvent> {
    const codexPath = executableFor('codex')
    const codex = new Codex({ env: codexEnv(), config: buildCodexConfig(opts) as never, ...(codexPath ? { codexPathOverride: codexPath } : {}) })
    const threadOptions = buildCodexThreadOptions(opts)
    const thread = opts.resumeSessionId ? codex.resumeThread(opts.resumeSessionId, threadOptions) : codex.startThread(threadOptions)
    const state: { threadId?: string } = { threadId: opts.resumeSessionId }
    const { events } = await thread.runStreamed(buildCodexPrompt(opts), { signal: opts.signal })
    for await (const ev of events) yield* mapCodexEvent(ev, opts.cwd, state)
    // Limite real da assinatura, lido do log local da thread (falha = sem dado).
    try {
      const file = state.threadId ? findRolloutFile(state.threadId) : undefined
      if (file) for (const limit of codexLimitsFromLog(readFileSync(file, 'utf8'), Date.now())) yield { type: 'limit', limit }
    } catch { /* log ausente ou ilegível */ }
  }
}
