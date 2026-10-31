import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent } from '@shared/events'
import { classifyToolCall, summarizeToolCall } from '../policy/commandPolicy'
import { safeEnv } from './env'
import { systemAppend, type AdapterRunOptions, type AgentAdapter } from './types'

// Curinga roda no opencode 2.x. O SDK do npm não fala com o CLI 2.x (spike da Fase 3A),
// então o app sobe o próprio `opencode serve` e usa a API HTTP /api/... direto.

export interface OcEvent { type?: string; data?: Record<string, unknown> }
export interface CreateSessionInput { directory: string; model: { providerID: string; id: string }; title: string }

export interface OpencodeApi {
  createSession(input: CreateSessionInput): Promise<string>
  prompt(sessionId: string, text: string): Promise<void>
  replyPermission(sessionId: string, requestId: string, decision: 'once' | 'reject', message?: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  events(signal: AbortSignal): AsyncIterable<OcEvent>
}

/** Comandos pedem aprovação ao app; edições são livres dentro da sessão, mas tudo passa pela política §6.4 no `permission.asked`. */
const RULES = [
  { action: 'shell', resource: '*', effect: 'ask' },
  { action: 'edit', resource: '*', effect: 'ask' },
  { action: 'webfetch', resource: '*', effect: 'ask' },
  { action: 'external_directory', resource: '*', effect: 'ask' },
  // Sub-agentes criam sessões filhas cujas permissões o app não acompanha: proibidos.
  { action: 'task', resource: '*', effect: 'deny' },
]
const DEFAULT_MODEL = 'opencode/big-pickle'

export function parseSse(buffer: string): { events: OcEvent[]; rest: string } {
  const events: OcEvent[] = []
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
    if (!data) continue
    try {
      events.push(JSON.parse(data))
    } catch {
      // bloco quebrado: ignora
    }
  }
  return { events, rest }
}

type ToolCall = { toolName: string; input: Record<string, unknown> }

/**
 * Transforma um pedido de permissão em chamadas para a política §6.4 — uma por recurso, para nenhum escapar.
 * `toolInput` é o input do `session.tool.called` correspondente: o comando roda no `workdir` dele, não na pasta do projeto.
 */
export function permissionToToolCalls(data: Record<string, unknown>, cwd: string, toolInput?: Record<string, unknown>): ToolCall[] {
  const resources = Array.isArray(data.resources) ? data.resources.map(String) : []
  switch (data.action) {
    case 'shell': {
      // O opencode manda cada comando de um pipe como um recurso; juntamos para a política avaliar todos.
      const command = resources.join(' | ')
      const workdir = typeof toolInput?.workdir === 'string' ? toolInput.workdir : undefined
      return [{ toolName: 'Bash', input: { command: workdir && workdir !== cwd ? `cd ${workdir} && ${command}` : command } }]
    }
    case 'edit': return resources.map(r => ({ toolName: 'Edit', input: { file_path: r } }))
    case 'read': return resources.map(r => ({ toolName: 'Read', input: { file_path: r } }))
    case 'webfetch': return resources.map(r => ({ toolName: 'WebFetch', input: { url: r } }))
    default: return [{ toolName: String(data.action), input: { resource: resources.join(', ') } }]
  }
}

export function mapOpencodeEvent(ev: OcEvent, sessionId: string, cwd: string): AgentEvent[] {
  const d = ev.data ?? {}
  if (d.sessionID !== sessionId) return []
  switch (ev.type) {
    case 'session.tool.called': {
      const input = (d.input ?? {}) as Record<string, unknown>
      if (typeof input.command === 'string') return [{ type: 'tool', name: 'Bash', summary: input.command }]
      const path = input.path ?? input.filePath
      if (typeof path !== 'string') return []
      const summary = summarizeToolCall({ toolName: 'Edit', input: { file_path: path } }, cwd)
      const writes = 'content' in input || 'newString' in input
      return writes ? [{ type: 'tool', name: 'Write', summary }, { type: 'file_changed', path: summary }] : [{ type: 'tool', name: 'Read', summary }]
    }
    case 'session.text.ended': return typeof d.text === 'string' && d.text.trim() ? [{ type: 'text', text: d.text }] : []
    case 'session.execution.succeeded': return [{ type: 'done', sessionId }]
    case 'session.execution.failed': {
      const err = d.error as { message?: string } | undefined
      return [{ type: 'error', message: err?.message ?? 'O opencode falhou.' }]
    }
    default: return []
  }
}

export interface Server { api: OpencodeApi; close(): Promise<void> | void; onExit?(cb: () => void): void }

export class OpencodeHost {
  private started?: Promise<Server>
  constructor(private start: () => Promise<Server>) {}

  async api(): Promise<OpencodeApi> {
    if (!this.started) {
      const started = this.start()
      this.started = started
      // Servidor que morreu é esquecido: o próximo pedido sobe outro.
      void started.then(s => s.onExit?.(() => { if (this.started === started) this.started = undefined }), () => {})
    }
    try {
      return (await this.started).api
    } catch (e) {
      this.started = undefined
      throw e
    }
  }

  /** Resolve quando o servidor saiu de fato; o app espera isso antes de fechar para não deixar órfão. */
  close(): Promise<void> {
    const started = this.started
    this.started = undefined
    return started ? started.then(s => s.close(), () => {}) : Promise.resolve()
  }

  get isRunning(): boolean {
    return !!this.started
  }
}

export class OpencodeAdapter implements AgentAdapter {
  constructor(private host: OpencodeHost) {}

  async *run(opts: AdapterRunOptions): AsyncIterable<AgentEvent> {
    if (opts.signal.aborted) return
    let api: OpencodeApi
    try {
      api = await this.host.api()
    } catch (e) {
      yield { type: 'error', message: `Não consegui iniciar o opencode: ${e instanceof Error ? e.message : String(e)}` }
      return
    }
    if (opts.signal.aborted) return
    const [providerID, id] = (opts.model ?? opts.agent.defaultModel ?? DEFAULT_MODEL).split(/\/(.*)/s)
    let sessionId: string
    try {
      sessionId = opts.resumeSessionId ?? await api.createSession({ directory: opts.cwd, model: { providerID, id }, title: opts.prompt.slice(0, 40) })
    } catch (e) {
      yield { type: 'error', message: e instanceof Error ? e.message : String(e) }
      return
    }
    const ctl = new AbortController()
    const aborted = new Promise<'abort'>(resolve => {
      const onAbort = () => { void api.interrupt(sessionId).catch(() => {}); resolve('abort') }
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    })
    const toolInputs = new Map<string, Record<string, unknown>>()

    // Assina os eventos antes de mandar o prompt para não perder o começo.
    const it = api.events(ctl.signal)[Symbol.asyncIterator]()
    const first = it.next()
    first.catch(() => {})
    try {
      if (opts.signal.aborted) return
      try {
        await api.prompt(sessionId, [systemAppend(opts.agent, opts.instructions), opts.prompt].join('\n\n'))
      } catch (e) {
        // Ex.: sessão retomada que o servidor não conhece mais (404) — o RunService tenta de novo sem retomar.
        yield { type: 'error', message: e instanceof Error ? e.message : String(e) }
        return
      }
      let next: Promise<IteratorResult<OcEvent>> = first
      for (;;) {
        // Cancelar não depende do servidor mandar algo depois do interrupt.
        const r = await Promise.race([next, aborted])
        if (r === 'abort' || opts.signal.aborted) return
        if (r.done) break
        next = it.next()
        const ev = r.value
        const d = ev.data ?? {}
        if (ev.type === 'session.tool.called' && d.sessionID === sessionId && typeof d.id === 'string') toolInputs.set(d.id, (d.input ?? {}) as Record<string, unknown>)
        if (ev.type === 'permission.asked' && d.sessionID === sessionId) {
          await this.answerPermission(api, sessionId, d, toolInputs, opts)
          continue
        }
        const out = mapOpencodeEvent(ev, sessionId, opts.cwd)
        yield* out
        if (out.some(e => e.type === 'done' || e.type === 'error')) return
      }
      if (!opts.signal.aborted) yield { type: 'error', message: 'A conexão com o opencode caiu no meio do pedido.' }
    } finally {
      ctl.abort()
    }
  }

  private async answerPermission(api: OpencodeApi, sessionId: string, d: Record<string, unknown>, toolInputs: Map<string, Record<string, unknown>>, opts: AdapterRunOptions) {
    const source = d.source as { id?: string } | undefined
    const calls = permissionToToolCalls(d, opts.cwd, source?.id ? toolInputs.get(source.id) : undefined)
    let allowed = false
    if (!opts.signal.aborted) {
      allowed = calls.every(c => classifyToolCall(c, opts.cwd) === 'allow')
      if (!allowed) {
        const call = calls.find(c => classifyToolCall(c, opts.cwd) === 'ask') ?? calls[0]
        allowed = await opts.requestApproval({ toolName: call.toolName, summary: calls.map(c => summarizeToolCall(c, opts.cwd)).join(', ') })
      }
    }
    try {
      await api.replyPermission(sessionId, String(d.id), allowed && !opts.signal.aborted ? 'once' : 'reject', allowed ? undefined : 'Natan negou este comando.')
    } catch (e) {
      // Pedido já resolvido pelo próprio opencode (404): segue; qualquer outra falha derruba o pedido.
      if (!/PermissionNotFound|→ 404/.test(String(e))) throw e
    }
  }
}

/** Cliente HTTP mínimo para as rotas que o adaptador usa (formatos confirmados no spike). */
export class HttpOpencodeApi implements OpencodeApi {
  private auth: string
  constructor(private base: string, password: string, private fetchFn: typeof fetch = fetch) {
    this.auth = 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64')
  }

  private async call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const r = await this.fetchFn(this.base + path, {
      method, headers: { Authorization: this.auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : {}
  }

  async createSession(input: CreateSessionInput): Promise<string> {
    const res = await this.call('POST', '/api/session', { title: input.title, location: { directory: input.directory }, model: input.model, permissions: RULES })
    return (res.data as { id: string }).id
  }
  async prompt(sessionId: string, text: string) { await this.call('POST', `/api/session/${sessionId}/prompt`, { text }) }
  async replyPermission(sessionId: string, requestId: string, decision: 'once' | 'reject', message?: string) {
    await this.call('POST', `/api/session/${sessionId}/permission/${requestId}/reply`, { decision, ...(message ? { message } : {}) })
  }
  async interrupt(sessionId: string) { await this.call('POST', `/api/session/${sessionId}/interrupt`) }

  async *events(signal: AbortSignal): AsyncIterable<OcEvent> {
    const r = await this.fetchFn(this.base + '/api/event', { headers: { Authorization: this.auth }, signal })
    if (!r.body) return
    const dec = new TextDecoder()
    let buf = ''
    try {
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        const parsed = parseSse(buf + dec.decode(chunk, { stream: true }))
        buf = parsed.rest
        yield* parsed.events
      }
    } catch (e) {
      if (!signal.aborted) throw e
    }
  }
}

/** Sobe `opencode serve` com senha aleatória e sem MCP do usuário; fecha matando o processo. */
export async function startOpencodeServer(spawnFn: typeof spawn = spawn): Promise<{ api: OpencodeApi; close(): Promise<void>; onExit(cb: () => void): void }> {
  const password = randomBytes(18).toString('base64url')
  // Só instruções do Natan (spec §7): sem config/plugins do projeto nem do usuário, sem MCP.
  const proc: ChildProcess = spawnFn('opencode', ['serve', '--hostname=127.0.0.1', '--port=0'], {
    env: {
      ...safeEnv(),
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: {}, plugin: [] }),
      OPENCODE_DISABLE_PROJECT_CONFIG: '1',
      OPENCODE_CONFIG_PROJECT_DISABLE: '1',
      OPENCODE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'tutti-opencode-config-')),
      OPENCODE_DISABLE_CLAUDE_CODE: '1',
      OPENCODE_DISABLE_AUTOUPDATE: '1',
    },
  })
  proc.stderr?.resume()
  const url = await new Promise<string>((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('o servidor não respondeu em 20 s')) }, 20_000)
    proc.on('error', e => { clearTimeout(timer); reject(e) })
    proc.stdout?.on('data', d => {
      out += d
      const m = out.match(/listening on (https?:\/\/\S+)/)
      if (m) { clearTimeout(timer); resolve(m[1]) }
    })
  })
  const exited = new Promise<void>(resolve => proc.on('exit', () => resolve()))
  const close = async () => {
    if (proc.exitCode !== null) return
    proc.kill('SIGTERM')
    // Com conexões ainda abertas o servidor pode demorar a sair; depois de 3 s, força.
    const force = setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL') }, 3000)
    await exited
    clearTimeout(force)
  }
  return { api: new HttpOpencodeApi(url, password), close, onExit: cb => { void exited.then(cb) } }
}
