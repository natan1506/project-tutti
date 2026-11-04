import { describe, expect, it } from 'vitest'
import { lookHandlers } from '../../src/main/lookIpc'

function store() {
  const m = new Map<string, unknown>()
  return { getSetting: <T>(k: string) => m.get(k) as T | undefined, setSetting: (k: string, v: unknown) => { m.set(k, v) } }
}

describe('aparência guardada', () => {
  it('grava, lê e restaura por agente; recusa valor inválido', () => {
    const h = lookHandlers(store())
    expect(h.looks()).toEqual({})
    h.setLook({ agentId: 'forja', look: { color: '#22cc88', eyes: 'happy' } })
    expect(h.looks()).toEqual({ forja: { color: '#22cc88', eyes: 'happy' } })
    expect(() => h.setLook({ agentId: 'forja', look: { color: 'vermelho' } })).toThrow()
    expect(() => h.setLook({ agentId: 'ninguem', look: {} })).toThrow()
    h.setLook({ agentId: 'forja', look: null })
    expect(h.looks()).toEqual({})
  })
})
