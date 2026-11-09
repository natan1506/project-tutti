import { describe, expect, it } from 'vitest'
import { parseCommand } from '../../src/cli/commands'

describe('comandos', () => {
  it('reconhece os comandos da tela', () => {
    expect(parseCommand('/exit')).toEqual({ kind: 'exit' })
    expect(parseCommand(' /new ')).toEqual({ kind: 'new' })
    expect(parseCommand('/stop')).toEqual({ kind: 'stop' })
    expect(parseCommand('/usage')).toEqual({ kind: 'usage' })
    expect(parseCommand('/undo')).toEqual({ kind: 'undo' })
    expect(parseCommand('/agents')).toEqual({ kind: 'agents' })
    expect(parseCommand('/history')).toEqual({ kind: 'history' })
    expect(parseCommand('/history 2')).toEqual({ kind: 'history', index: 2 })
    expect(parseCommand('/config')).toEqual({ kind: 'config' })
    expect(parseCommand('/config executor Curinga')).toEqual({ kind: 'config', key: 'executor', value: 'Curinga' })
    expect(parseCommand('/config perfil Meu Time')).toEqual({ kind: 'config', key: 'perfil', value: 'Meu Time' })
  })
  it('texto livre vai para o time; comando desconhecido é avisado', () => {
    expect(parseCommand('oi')).toEqual({ kind: 'send', text: 'oi' })
    expect(parseCommand('/xyz')).toEqual({ kind: 'unknown', name: 'xyz' })
    expect(parseCommand('/config cor azul')).toEqual({ kind: 'unknown', name: 'config cor' })
  })
})
