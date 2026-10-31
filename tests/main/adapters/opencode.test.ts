import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { getAgent } from '@shared/agents'
import type { AgentEvent } from '@shared/events'
import type { AdapterRunOptions } from '../../../src/main/adapters/types'
import {
  mapOpencodeEvent, OpencodeAdapter, OpencodeHost, parseSse, permissionToToolCall, startOpencodeServer, type OcEvent, type OpencodeApi,
} from '../../../src/main/adapters/opencode'

const FIX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'opencode-events.json'), 'utf8')) as OcEvent[]
const SID = 'ses_e6d51ca04ffeQ3ff1Qbnk25U74'
const CWD = (FIX.find(e => e.type === 'session.created')!.data as { location: { directory: string } }).location.directory

const opts = (o: Partial<AdapterRunOptions> = {}): AdapterRunOptions => ({
  agent: getAgent('curinga'), prompt: 'faz', cwd: CWD, instructions: 'REGRAS', signal: new AbortController().signal,
  requestApproval: vi.fn(async () => false), ...o,
})

/** API falsa: entrega os eventos da fixture (ou os que o teste mandar) depois do prompt. */
function fakeApi(events: OcEvent[] = FIX) {
  const replies: unknown[] = []
  let push!: (e: OcEvent | null) => void
  const queue: (OcEvent | null)[] = []
  let wake: (() => void) | undefined
  push = e => { queue.push(e); wake?.() }
  const api: OpencodeApi & { replies: unknown[]; interrupted: string[]; prompts: string[]; created: unknown[] } = {
    replies, interrupted: [], prompts: [], created: [],
    async createSession(input) { api.created.push(input); return SID },
    async prompt(sessionId, text) { api.prompts.push(text); for (const e of events) push(e); push(null) },
    async replyPermission(sessionId, requestId, decision, message) { replies.push({ sessionId, requestId, decision, message }) },
    async interrupt(sessionId) { api.interrupted.push(sessionId); push(null) },
    async *events(signal) {
      while (!signal.aborted) {
        if (!queue.length) await new Promise<void>(r => { wake = r })
        const e = queue.shift()
        if (e === null) return
        if (e) yield e
      }
    },
  }
  return api
}
async function collect(it: AsyncIterable<AgentEvent>) { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out }

describe('parseSse', () => {
  it('separa eventos por linha em branco e guarda o resto incompleto', () => {
    const { events, rest } = parseSse('data: {"type":"a"}\n\ndata: {"type":"b"}\n\ndata: {"ty')
    expect(events).toEqual([{ type: 'a' }, { type: 'b' }])
    expect(rest).toBe('data: {"ty')
  })
  it('ignora comentários e JSON quebrado', () => {
    expect(parseSse(': ping\n\ndata: {oops\n\n').events).toEqual([])
  })
})

describe('permissionToToolCall', () => {
  it('shell vira Bash com o comando', () => {
    expect(permissionToToolCall({ action: 'shell', resources: ['npm install left-pad'] })).toEqual({ toolName: 'Bash', input: { command: 'npm install left-pad' } })
  })
  it('edit vira Edit com o caminho', () => {
    expect(permissionToToolCall({ action: 'edit', resources: ['/x/a.ts'] })).toEqual({ toolName: 'Edit', input: { file_path: '/x/a.ts' } })
  })
  it('pipe chega como vários recursos e todos entram no comando avaliado', () => {
    const call = permissionToToolCall({ action: 'shell', resources: ['ls', 'rm -rf src'] })
    expect(call).toEqual({ toolName: 'Bash', input: { command: 'ls | rm -rf src' } })
  })
  it('ação desconhecida mantém o nome (cai em pedir aprovação)', () => {
    expect(permissionToToolCall({ action: 'external_directory', resources: ['/etc'] })).toEqual({ toolName: 'external_directory', input: {} })
  })
})

describe('mapOpencodeEvent', () => {
  it('converte a execução da fixture e ignora outra sessão', () => {
    const evs = FIX.flatMap(e => mapOpencodeEvent(e, SID, CWD))
    expect(evs).toEqual([
      { type: 'tool', name: 'Write', summary: 'a.txt' },
      { type: 'file_changed', path: 'a.txt' },
      { type: 'tool', name: 'Bash', summary: 'npm install left-pad' },
      { type: 'text', text: expect.stringContaining('negado') },
      { type: 'done', sessionId: SID },
    ])
    expect(FIX.flatMap(e => mapOpencodeEvent(e, 'outra', CWD))).toEqual([])
  })
  it('execução que falha vira erro', () => {
    expect(mapOpencodeEvent({ type: 'session.execution.failed', data: { sessionID: SID, error: { message: 'cota' } } }, SID, CWD))
      .toEqual([{ type: 'error', message: 'cota' }])
  })
})

describe('OpencodeHost', () => {
  it('sobe o servidor uma vez e fecha', async () => {
    const close = vi.fn()
    const start = vi.fn(async () => ({ api: fakeApi(), close }))
    const host = new OpencodeHost(start)
    await host.api(); await host.api()
    expect(start).toHaveBeenCalledOnce()
    await host.close()
    expect(close).toHaveBeenCalledOnce()
    expect(host.isRunning).toBe(false)
  })
})

describe('OpencodeAdapter', () => {
  it('cria sessão na pasta, com regras de permissão, e pergunta ao Natan só o que a política pede', async () => {
    const api = fakeApi()
    const o = opts()
    const evs = await collect(new OpencodeAdapter(new OpencodeHost(async () => ({ api, close() {} }))).run(o))
    expect(api.created).toEqual([expect.objectContaining({ directory: CWD })])
    expect(o.requestApproval).toHaveBeenCalledWith({ toolName: 'Bash', summary: 'npm install left-pad' })
    expect(api.replies).toEqual([{ sessionId: SID, requestId: 'per_192ae45dd001G61fpJKXWGNxRE', decision: 'reject', message: 'Natan negou este comando.' }])
    expect(evs.at(-1)).toEqual({ type: 'done', sessionId: SID })
    expect(api.prompts[0]).toContain(getAgent('curinga').persona)
  })

  it('permissão liberada pela política é aceita sem perguntar', async () => {
    const ask: OcEvent = { type: 'permission.asked', data: { id: 'per_1', sessionID: SID, action: 'shell', resources: ['ls -la'] } }
    const api = fakeApi([ask, { type: 'session.execution.succeeded', data: { sessionID: SID } }])
    const o = opts()
    await collect(new OpencodeAdapter(new OpencodeHost(async () => ({ api, close() {} }))).run(o))
    expect(o.requestApproval).not.toHaveBeenCalled()
    expect(api.replies).toEqual([{ sessionId: SID, requestId: 'per_1', decision: 'once', message: undefined }])
  })

  it('cancelar interrompe a sessão e o servidor continua servindo o próximo pedido', async () => {
    const api = fakeApi([])
    api.prompt = async () => {}
    const host = new OpencodeHost(async () => ({ api, close() {} }))
    const ctl = new AbortController()
    const run = collect(new OpencodeAdapter(host).run(opts({ signal: ctl.signal })))
    await new Promise(r => setTimeout(r, 10))
    ctl.abort()
    await run
    expect(api.interrupted).toEqual([SID])
    const api2ok = await collect(new OpencodeAdapter(new OpencodeHost(async () => ({ api: fakeApi(), close() {} }))).run(opts()))
    expect(api2ok.at(-1)?.type).toBe('done')
  })

  it('permissão já resolvida (404 ao responder) não derruba o pedido', async () => {
    const ask: OcEvent = { type: 'permission.asked', data: { id: 'per_x', sessionID: SID, action: 'edit', resources: ['a.txt'] } }
    const api = fakeApi([ask, { type: 'session.execution.succeeded', data: { sessionID: SID } }])
    api.replyPermission = async () => { throw new Error('POST … → 404 {"_tag":"PermissionNotFoundError"}') }
    const evs = await collect(new OpencodeAdapter(new OpencodeHost(async () => ({ api, close() {} }))).run(opts()))
    expect(evs.at(-1)).toEqual({ type: 'done', sessionId: SID })
  })

  it('falha ao subir o servidor vira erro amigável', async () => {
    const evs = await collect(new OpencodeAdapter(new OpencodeHost(async () => { throw new Error('porta ocupada') })).run(opts()))
    expect(evs).toEqual([{ type: 'error', message: 'Não consegui iniciar o opencode: porta ocupada' }])
  })
})

describe('startOpencodeServer', () => {
  it('fecha com SIGTERM e, se o servidor não sair em 3 s, SIGKILL; a promessa só resolve quando ele sai', async () => {
    vi.useFakeTimers()
    const { EventEmitter } = await import('node:events')
    const { PassThrough } = await import('node:stream')
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, signals: [] as string[] })
    ;(proc as unknown as { kill(s: string): boolean }).kill = (s: string) => { proc.signals.push(s); return true }
    const started = startOpencodeServer((() => proc) as never)
    proc.stdout.write('Server listening on http://127.0.0.1:5555\n')
    const srv = await started
    let closed = false
    const closing = srv.close().then(() => { closed = true })
    expect(proc.signals).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(3100)
    expect(proc.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(closed).toBe(false)
    proc.exitCode = 137; proc.emit('exit', 137)
    await closing
    expect(closed).toBe(true)
    vi.useRealTimers()
  })
})
