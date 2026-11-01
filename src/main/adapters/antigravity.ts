import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentEvent } from '@shared/events'
import { addTokens, zeroTokens, type TokenUsage } from '@shared/usage'
import { summarizeToolCall } from '../policy/commandPolicy'
import { safeEnv } from './env'
import { systemAppend, type AdapterRunOptions, type AgentAdapter } from './types'

// Radar roda no Antigravity CLI (`agy`). O modo `plan` bloqueia escrita e comandos no projeto (spike da Fase 3A).

const READ_TOOLS: Record<string, string> = {
  read_file: 'Read', view_file: 'Read', list_dir: 'Grep', grep_search: 'Grep', find_by_name: 'Grep',
  search_web: 'WebSearch', read_url_content: 'WebSearch',
}

export interface AgyState { sessionId?: string; texts: Map<number, string>; spoke: boolean; blocked?: string; tokens: TokenUsage }
export const newAgyState = (): AgyState => ({ texts: new Map(), spoke: false, tokens: zeroTokens() })

export function buildAgyArgs(opts: AdapterRunOptions): string[] {
  return [
    '-p', [systemAppend(opts.agent, opts.instructions), opts.prompt].join('\n\n'),
    '--output-format', 'stream-json', '--mode', 'plan', '--disable-slash-commands',
    ...(opts.model ? ['--model', opts.model] : []),
    ...(opts.resumeSessionId ? ['--conversation', opts.resumeSessionId] : []),
  ]
}

function toolSummary(name: string, params: Record<string, unknown>, cwd: string): string {
  if (typeof params.query === 'string') return params.query
  if (typeof params.Url === 'string') return params.Url
  const path = params.Path ?? params.DirectoryPath ?? params.SearchPath
  return typeof path === 'string' ? summarizeToolCall({ toolName: 'Read', input: { file_path: path } }, cwd) : name
}

export function mapAgyEvent(line: string, cwd: string, st: AgyState): AgentEvent[] {
  let ev: { event?: string; conversation_id?: string; step_update?: Record<string, unknown>; result?: Record<string, unknown> }
  try {
    ev = JSON.parse(line)
  } catch {
    return []
  }
  if (ev.event === 'init') { st.sessionId = ev.conversation_id; return [] }
  const s = ev.step_update
  if (ev.event === 'step_update' && s) {
    const idx = s.step_index as number
    const u = s.usage as { input_tokens?: number; output_tokens?: number; thinking_tokens?: number; cache_read_tokens?: number } | undefined
    if (u && s.state === 'DONE') st.tokens = addTokens(st.tokens, { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_tokens ?? 0, reasoning: u.thinking_tokens ?? 0 })
    if (s.step_type === 'agent_response') {
      st.texts.set(idx, (st.texts.get(idx) ?? '') + ((s.text_delta as string) ?? ''))
      if (s.state !== 'DONE') return []
      const text = (st.texts.get(idx) ?? '').trim()
      if (!text) return []
      st.spoke = true
      return [{ type: 'text', text }]
    }
    if (s.step_type === 'tool') {
      const name = s.tool_name as string
      const params = ((s.tool_info as { parameters?: Record<string, unknown> })?.parameters) ?? {}
      if (s.state === 'ERROR' && !READ_TOOLS[name]) st.blocked = name
      // Só leituras concluídas aparecem; escritas internas do agy (plano em ~/.gemini) e tentativas bloqueadas não.
      if (s.state !== 'DONE' || !READ_TOOLS[name]) return []
      return [{ type: 'tool', name: READ_TOOLS[name], summary: toolSummary(name, params, cwd) }]
    }
    return []
  }
  if (ev.event === 'result' && ev.result) {
    const r = ev.result
    const response = ((r.response as string) ?? '').trim()
    if (r.status !== 'SUCCESS') return [{ type: 'error', message: response || String(r.status) }]
    const out: AgentEvent[] = []
    if (!st.spoke && response) out.push({ type: 'text', text: response })
    else if (!st.spoke) out.push({ type: 'text', text: `Não consegui responder: tentei uma ação que o Radar não pode fazer (${st.blocked ?? 'desconhecida'}).` })
    out.push({ type: 'usage', tool: 'gemini', tokens: st.tokens })
    out.push({ type: 'done', sessionId: (r.conversation_id as string) ?? st.sessionId })
    return out
  }
  return []
}

type SpawnFn = (cmd: string, args: string[], opts: { cwd: string; env: Record<string, string> }) => ChildProcess

export class AntigravityAdapter implements AgentAdapter {
  constructor(private spawnFn: SpawnFn = spawn as unknown as SpawnFn) {}

  async *run(opts: AdapterRunOptions): AsyncIterable<AgentEvent> {
    const child = this.spawnFn('agy', buildAgyArgs(opts), { cwd: opts.cwd, env: safeEnv() })
    let spawnError: Error | undefined
    const closed = new Promise<number>(resolve => {
      child.on('close', code => resolve(code ?? 1))
      // Sem este listener, um `agy` que sumiu (ENOENT) derruba o processo principal.
      child.on('error', e => { spawnError = e; resolve(-1) })
    })
    const stderr: string[] = []
    child.stderr?.on('data', d => stderr.push(...String(d).split('\n').filter(Boolean)))
    let killTimer: NodeJS.Timeout | undefined
    const onAbort = () => {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 2000)
    }
    if (opts.signal.aborted) onAbort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })

    const st = newAgyState()
    let finished = false
    try {
      for await (const line of createInterface({ input: child.stdout! })) {
        for (const ev of mapAgyEvent(line, opts.cwd, st)) {
          if (ev.type === 'done' || ev.type === 'error') finished = true
          yield ev
        }
      }
      const code = await closed
      if (spawnError) yield { type: 'error', message: `Não consegui rodar o Antigravity: ${spawnError.message}` }
      else if (!finished && !opts.signal.aborted) {
        yield { type: 'error', message: `O Antigravity saiu com código ${code}: ${stderr.slice(-5).join(' | ') || 'sem detalhes'}` }
      }
    } finally {
      opts.signal.removeEventListener('abort', onAbort)
      if (killTimer && child.exitCode !== null) clearTimeout(killTimer)
    }
  }
}
