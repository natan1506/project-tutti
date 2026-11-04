import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decide, isInside } from '../../../src/main/policy/commandPolicy'

// No macOS, /var e /tmp são atalhos para /private/…: o agente pode escrever pelo caminho real do projeto.
describe('caminho real do projeto', () => {
  const dir = mkdtempSync(join(tmpdir(), 'real-'))
  const real = realpathSync(dir)

  it('o mesmo projeto pelo caminho real conta como dentro', () => {
    expect(isInside(dir, join(real, 'b.txt'))).toBe(true)
    expect(isInside(real, join(dir, 'novo/pasta/c.txt'))).toBe(true)
    expect(isInside(dir, '/private/etc/hosts')).toBe(false)
  })

  it('Perguntar tudo pergunta pelo motivo certo; Aceitar edições libera', () => {
    const call = { toolName: 'Write', input: { file_path: join(real, 'b.txt') } }
    expect(decide(call, dir, { level: 'ask_all', sandboxed: false })).toEqual({ decision: 'ask', reason: 'ask_all' })
    expect(decide(call, dir, { level: 'accept_edits', sandboxed: false }).decision).toBe('allow')
  })
})
