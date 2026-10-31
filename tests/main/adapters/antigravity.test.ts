import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAgent } from '@shared/agents'
import type { AgentEvent } from '@shared/events'
import type { AdapterRunOptions } from '../../../src/main/adapters/types'
import { AntigravityAdapter, buildAgyArgs, mapAgyEvent, newAgyState } from '../../../src/main/adapters/antigravity'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8').split('\n').filter(Boolean)
const opts = (o: Partial<AdapterRunOptions> = {}): AdapterRunOptions => ({
  agent: getAgent('radar'), prompt: 'Pesquise X', cwd: '/tmp/proj', instructions: 'REGRAS', signal: new AbortController().signal,
  requestApproval: vi.fn(async () => true), ...o,
})
const mapAll = (lines: string[]) => {
  const cwd = JSON.parse(lines[0]).init.cwd as string
  const st = newAgyState()
  return lines.flatMap(l => mapAgyEvent(l, cwd, st))
}

describe('buildAgyArgs', () => {
  it('modo plan (só leitura), stream-json, sem slash commands', () => {
    const a = buildAgyArgs(opts())
    expect(a.slice(0, 2)).toEqual(['-p', `${getAgent('radar').persona}\n\nREGRAS\n\nPesquise X`])
    expect(a).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '--mode', 'plan', '--disable-slash-commands']))
    expect(a.join(' ')).not.toMatch(/dangerously-skip-permissions|--mode (auto|accept-edits)/)
  })
  it('consulta e trabalho têm os mesmos argumentos (modo plan)', () => {
    expect(buildAgyArgs(opts({ mode: 'consult' }))).toEqual(buildAgyArgs(opts()))
  })
  it('modelo e retomada', () => {
    const a = buildAgyArgs(opts({ model: 'gemini-x', resumeSessionId: 'c1' }))
    expect(a.join(' ')).toContain('--model gemini-x')
    expect(a.join(' ')).toContain('--conversation c1')
  })
})

describe('mapAgyEvent', () => {
  it('pesquisa só leitura: texto completo, leitura, busca e fim com a conversa', () => {
    const evs = mapAll(fixture('agy-plan-readonly.jsonl'))
    expect(evs).toEqual([
      { type: 'text', text: expect.stringMatching(/^Vou ler o arquivo `hello.txt` e pesquisar.*`x\.txt`\.$/s) },
      { type: 'tool', name: 'Read', summary: 'hello.txt' },
      { type: 'tool', name: 'WebSearch', summary: 'current Node.js LTS version' },
      { type: 'done', sessionId: '10c43eb6-2e76-420c-ac3b-37043eb6148f' },
    ])
  })

  it('ação bloqueada sem resposta vira aviso no chat em vez de silêncio', () => {
    const evs = mapAll(fixture('agy-command-blocked.jsonl'))
    expect(evs).toEqual([
      { type: 'tool', name: 'Read', summary: 'hello.txt' },
      { type: 'text', text: 'Não consegui responder: tentei uma ação que o Radar não pode fazer (run_command).' },
      { type: 'done', sessionId: '00098d08-50d6-4527-b335-e1fb10205b89' },
    ])
  })

  it('resultado com falha vira erro; linha que não é JSON é ignorada', () => {
    const st = newAgyState()
    expect(mapAgyEvent('não é json', '/x', st)).toEqual([])
    expect(mapAgyEvent(JSON.stringify({ event: 'result', result: { conversation_id: 'c', status: 'ERROR', response: 'quota' } }), '/x', st))
      .toEqual([{ type: 'error', message: 'quota' }])
  })
})

class FakeChild extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); killed: string[] = []; exitCode: number | null = null
  kill(sig: string) { this.killed.push(sig); return true }
  finish(code: number) { this.exitCode = code; this.stdout.end(); this.stderr.end(); this.emit('close', code) }
}

async function collect(it: AsyncIterable<AgentEvent>) { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out }

describe('AntigravityAdapter', () => {
  afterEach(() => vi.useRealTimers())

  it('roda agy na pasta do projeto, sem chaves de API, e emite os eventos em ordem', async () => {
    process.env.GEMINI_API_KEY = 'k'
    const child = new FakeChild()
    const spawnFn = vi.fn(() => child)
    const run = collect(new AntigravityAdapter(spawnFn as never).run(opts()))
    for (const l of fixture('agy-plan-readonly.jsonl')) child.stdout.write(l + '\n')
    child.finish(0)
    const evs = await run
    delete process.env.GEMINI_API_KEY
    const [cmd, , o] = spawnFn.mock.calls[0] as unknown as [string, string[], { cwd: string; env: Record<string, string> }]
    expect(cmd).toBe('agy')
    expect(o.cwd).toBe('/tmp/proj')
    expect(o.env).not.toHaveProperty('GEMINI_API_KEY')
    expect(evs.map(e => e.type)).toEqual(['text', 'tool', 'tool', 'done'])
  })

  it('saída com erro e sem resultado vira erro com o stderr', async () => {
    const child = new FakeChild()
    const run = collect(new AntigravityAdapter((() => child) as never).run(opts()))
    child.stderr.write('linha 1\nnot logged in\n')
    child.finish(1)
    expect(await run).toEqual([{ type: 'error', message: expect.stringContaining('not logged in') }])
  })

  it('cancelar manda SIGTERM e, se não sair em 2 s, SIGKILL', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const ctl = new AbortController()
    const run = collect(new AntigravityAdapter((() => child) as never).run(opts({ signal: ctl.signal })))
    ctl.abort()
    expect(child.killed).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(2100)
    expect(child.killed).toEqual(['SIGTERM', 'SIGKILL'])
    child.finish(137)
    await run
  })
  it('M2: agy que sumiu (ENOENT) vira erro em vez de derrubar o app ou travar', async () => {
    const child = new FakeChild()
    const run = collect(new AntigravityAdapter((() => child) as never).run(opts()))
    child.emit('error', Object.assign(new Error('spawn agy ENOENT'), { code: 'ENOENT' }))
    child.stdout.end(); child.stderr.end()
    const evs = await Promise.race([run, new Promise<AgentEvent[]>(r => setTimeout(() => r([{ type: 'error', message: 'TRAVOU' }]), 500))])
    expect(evs).toEqual([{ type: 'error', message: expect.stringContaining('ENOENT') }])
  })
})
