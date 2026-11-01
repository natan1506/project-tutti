import type { ThreadEvent } from '@openai/codex-sdk'
import { describe, expect, it, vi } from 'vitest'
import { getAgent } from '@shared/agents'
import type { AdapterRunOptions } from '../../../src/main/adapters/types'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCodexPrompt, buildCodexThreadOptions, codexEnv, codexLimitsFromLog, findRolloutFile, mapCodexEvent, unwrapShell } from '../../../src/main/adapters/codex'

const cwd = '/tmp/proj'
const opts = (o: Partial<AdapterRunOptions> = {}): AdapterRunOptions => ({
  agent: getAgent('lupa'), prompt: 'Revise src/a.ts', cwd, instructions: 'REGRAS', signal: new AbortController().signal,
  requestApproval: vi.fn(async () => true), ...o,
})
const ev = (e: unknown) => e as ThreadEvent

describe('buildCodexThreadOptions', () => {
  it('é só-leitura e nunca pede aprovação', () => {
    expect(buildCodexThreadOptions(opts())).toEqual({
      sandboxMode: 'read-only', approvalPolicy: 'never', workingDirectory: cwd, skipGitRepoCheck: true,
    })
  })
  it('consulta e trabalho têm as mesmas opções (já é só leitura)', () => {
    expect(buildCodexThreadOptions(opts({ mode: 'consult' }))).toEqual(buildCodexThreadOptions(opts()))
  })
  it('repassa o modelo quando definido', () => {
    expect(buildCodexThreadOptions(opts({ model: 'gpt-x' })).model).toBe('gpt-x')
  })
})

describe('buildCodexPrompt', () => {
  it('junta persona, instruções e pedido', () => {
    expect(buildCodexPrompt(opts())).toBe(`${getAgent('lupa').persona}\n\nREGRAS\n\nRevise src/a.ts`)
  })
  it('sem instruções não deixa linhas vazias sobrando', () => {
    expect(buildCodexPrompt(opts({ instructions: '' }))).toBe(`${getAgent('lupa').persona}\n\nRevise src/a.ts`)
  })
})

describe('unwrapShell', () => {
  it('tira o embrulho do zsh', () => {
    expect(unwrapShell(`/bin/zsh -lc 'cat hello.txt'`)).toBe('cat hello.txt')
    expect(unwrapShell(`/bin/zsh -lc "rg --files"`)).toBe('rg --files')
    expect(unwrapShell('ls')).toBe('ls')
  })
})

describe('mapCodexEvent', () => {
  it('mensagem do agente concluída vira texto', () => {
    expect(mapCodexEvent(ev({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: 'ok' } }), cwd, {}))
      .toEqual([{ type: 'text', text: 'ok' }])
  })
  it('comando iniciado vira passo com o comando limpo', () => {
    expect(mapCodexEvent(ev({ type: 'item.started', item: { id: 'i', type: 'command_execution', command: `/bin/zsh -lc 'cat a.ts'`, status: 'in_progress' } }), cwd, {}))
      .toEqual([{ type: 'tool', name: 'Shell', summary: 'cat a.ts' }])
  })
  it('comando concluído não duplica o passo', () => {
    expect(mapCodexEvent(ev({ type: 'item.completed', item: { id: 'i', type: 'command_execution', command: 'ls', status: 'completed' } }), cwd, {})).toEqual([])
  })
  it('mudança de arquivo vira arquivos alterados relativos', () => {
    expect(mapCodexEvent(ev({ type: 'item.completed', item: { id: 'i', type: 'file_change', status: 'completed', changes: [{ path: cwd + '/src/a.ts', kind: 'update' }] } }), cwd, {}))
      .toEqual([{ type: 'file_changed', path: 'src/a.ts' }])
  })
  it('fim do turno devolve o id da thread vista no início', () => {
    const state = {}
    expect(mapCodexEvent(ev({ type: 'thread.started', thread_id: 't1' }), cwd, state)).toEqual([])
    expect(mapCodexEvent(ev({ type: 'turn.completed', usage: {} }), cwd, state)).toEqual([{ type: 'done', sessionId: 't1' }])
  })
  it('falhas viram erro', () => {
    expect(mapCodexEvent(ev({ type: 'turn.failed', error: { message: 'x' } }), cwd, {})).toEqual([{ type: 'error', message: 'x' }])
    expect(mapCodexEvent(ev({ type: 'error', message: 'y' }), cwd, {})).toEqual([{ type: 'error', message: 'y' }])
  })
  it('ignora o resto', () => {
    expect(mapCodexEvent(ev({ type: 'turn.started' }), cwd, {})).toEqual([])
  })
})

describe('codexEnv', () => {
  it('remove chaves de API e endpoints alternativos', () => {
    Object.assign(process.env, { OPENAI_API_KEY: 'k', CODEX_API_KEY: 'k', OPENAI_BASE_URL: 'http://x' })
    const env = codexEnv()
    for (const k of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL']) { expect(env).not.toHaveProperty(k); delete process.env[k] }
    expect(env).toHaveProperty('PATH')
  })
})

describe('uso e limite do Codex', () => {
  it('turno concluído com usage emite tokens antes do fim (sem contar cache como entrada)', () => {
    const st = { threadId: 't1' }
    expect(mapCodexEvent(ev({ type: 'turn.completed', usage: { input_tokens: 30553, cached_input_tokens: 27392, output_tokens: 145, reasoning_output_tokens: 9 } }), cwd, st)).toEqual([
      { type: 'usage', tool: 'codex', tokens: { input: 3161, output: 145, cacheRead: 27392, reasoning: 9 } },
      { type: 'done', sessionId: 't1' },
    ])
  })
  it('lê o último rate_limits do log local: primary = 5 h, secondary = semanal', () => {
    const text = readFileSync(join(__dirname, 'fixtures', 'codex-rollout.jsonl'), 'utf8')
    expect(codexLimitsFromLog(text, 5)).toEqual([
      { tool: 'codex', window: 'five_hour', utilization: 14, resetsAt: 1793462010_000, at: 5 },
      { tool: 'codex', window: 'seven_day', utilization: 4, resetsAt: 1794048810_000, at: 5 },
    ])
    expect(codexLimitsFromLog('nada aqui', 5)).toEqual([])
  })
  it('acha o arquivo da thread nas pastas de sessão', () => {
    const root = mkdtempSync(join(tmpdir(), 'cx-'))
    mkdirSync(join(root, '2026/10/31'), { recursive: true })
    writeFileSync(join(root, '2026/10/31/rollout-2026-10-31T08-22-10-abc-123.jsonl'), '')
    expect(findRolloutFile('abc-123', root)).toBe(join(root, '2026/10/31/rollout-2026-10-31T08-22-10-abc-123.jsonl'))
    expect(findRolloutFile('zzz', root)).toBeUndefined()
  })
})
