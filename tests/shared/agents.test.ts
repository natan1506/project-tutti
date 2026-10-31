import { describe, expect, it } from 'vitest'
import { AGENTS, getAgent } from '@shared/agents'

describe('elenco', () => {
  it('segue o spec §4', () => {
    expect(AGENTS.map(a => [a.id, a.tool])).toEqual([
      ['bussola', 'claude'], ['forja', 'claude'], ['pincel', 'claude'],
      ['radar', 'gemini'], ['lupa', 'codex'], ['curinga', 'opencode'],
    ])
    expect(getAgent('lupa').readOnly).toBe(true)
    expect(getAgent('radar').readOnly).toBe(true)
    expect(AGENTS.every(a => !('availableInPhase' in a))).toBe(true)
    expect(getAgent('forja').nome).toBe('Forja')
    expect(getAgent('bussola').nome).toBe('Bússola')
  })
})
