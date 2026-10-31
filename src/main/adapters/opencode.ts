import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
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

export function permissionToToolCall(data: Record<string, unknown>): { toolName: string; input: Record<string, unknown> } {
  const resources = Array.isArray(data.resources) ? data.resources.map(String) : []
  const first = resources[0] ?? ''
  switch (data.action) {
    // O opencode manda cada comando de um pipe como um recurso; juntamos para a política avaliar todos.
    case 'shell': return { toolName: 'Bash', input: { command: resources.join(' | ') } }
    case 'edit': return { toolName: 'Edit', input: { file_path: first } }
    case 'read': return { toolName: 'Read', input: { file_path: first } }
    case 'webfetch': return { toolName: 'WebFetch', input: { url: first } }
    default: return { toolName: String(data.action), input: {} }
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

export interface Server { api: OpencodeApi; close(): Promise<void> | void }

export class OpencodeHost {
  private started?: Promise<Server>
  private running?: Server
  constructor(private start: () => Promise<Server>) {}

  async api(): Promise<OpencodeApi> {
    this.started ??= this.start()
    try {
      this.running = await this.started
      return this.running.api
    } catch (e) {
      this.started = undefined
      throw e
    }
  }

  /** Resolve quando o servidor saiu de fato; o app espera isso antes de fechar para não deixar órfão. */
  close(): Promise<void> {
    const started = this.started
    this.running = undefined
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
    let api: OpencodeApi
    try {
      api = await this.host.api()
    } catch (e) {
      yield { type: 'error', message: `Não consegui iniciar o opencode: ${e instanceof Error ? e.message : String(e)}` }
      return
    }
    const [providerID, id] = (opts.model ?? opts.agent.defaultModel ?? DEFAULT_MODEL).split(/\/(.*)/s)
    const sessionId = opts.resumeSessionId
      ?? await api.createSession({ directory: opts.cwd, model: { providerID, id }, title: opts.prompt.slice(0, 40) })
    const ctl = new AbortController()
    const onAbort = () => { void api.interrupt(sessionId).catch(() => {}) }
    if (opts.signal.aborted) onAbort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })

    // Assina os eventos antes de mandar o prompt para não perder o começo.
    const it = api.events(ctl.signal)[Symbol.asyncIterator]()
    const first = it.next()
    try {
      await api.prompt(sessionId, [systemAppend(opts.agent, opts.instructions), opts.prompt].join('\n\n'))
      for (let r = await first; !r.done; r = await it.next()) {
        const ev = r.value
        if (ev.type === 'permission.asked' && ev.data?.sessionID === sessionId) {
          const call = permissionToToolCall(ev.data)
          const allowed = classifyToolCall(call, opts.cwd) === 'allow'
            || await opts.requestApproval({ toolName: call.toolName, summary: summarizeToolCall(call, opts.cwd) })
          try {
            await api.replyPermission(sessionId, String(ev.data.id), allowed ? 'once' : 'reject', allowed ? undefined : 'Natan negou este comando.')
          } catch (e) {
            // Pedido já resolvido pelo próprio opencode (404): segue; qualquer outra falha derruba o pedido.
            if (!/PermissionNotFound|→ 404/.test(String(e))) throw e
          }
          continue
        }
        const out = mapOpencodeEvent(ev, sessionId, opts.cwd)
        yield* out
        if (out.some(e => e.type === 'done' || e.type === 'error')) return
      }
    } finally {
      opts.signal.removeEventListener('abort', onAbort)
      ctl.abort()
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
export async function startOpencodeServer(spawnFn: typeof spawn = spawn): Promise<{ api: OpencodeApi; close(): Promise<void> }> {
  const password = randomBytes(18).toString('base64url')
  const proc: ChildProcess = spawnFn('opencode', ['serve', '--hostname=127.0.0.1', '--port=0'], {
    env: { ...safeEnv(), OPENCODE_SERVER_PASSWORD: password, OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: {} }) },
  })
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
  return { api: new HttpOpencodeApi(url, password), close }
}
