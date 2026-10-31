import type { ThreadEvent } from '@openai/codex-sdk'
import { describe, expect, it, vi } from 'vitest'
import { getAgent } from '@shared/agents'
import type { AdapterRunOptions } from '../../../src/main/adapters/types'
import { buildCodexPrompt, buildCodexThreadOptions, codexEnv, mapCodexEvent, unwrapShell } from '../../../src/main/adapters/codex'

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
