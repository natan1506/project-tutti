import { describe, expect, it } from 'vitest'
import { COMMANDS, matchCommands } from '../../src/cli/menus'
import { parseCommand } from '../../src/cli/commands'

describe('menu de comandos', () => {
  it('só "/" mostra todos os comandos, cada um com o que faz', () => {
    const all = matchCommands('/')
    expect(all.map(c => c.name)).toEqual(COMMANDS.map(c => c.name))
    expect(all.every(c => c.desc.length > 10)).toBe(true)
    for (const n of ['config', 'agents', 'mcp', 'usage', 'history', 'new', 'clear', 'undo', 'doctor', 'stop', 'help', 'exit']) expect(all.map(c => c.name)).toContain(n)
  })
  it('filtra pelo começo e depois por trecho', () => {
    expect(matchCommands('/co').map(c => c.name)).toEqual(['config'])
    expect(matchCommands('/st').map(c => c.name)[0]).toBe('stop')
    expect(matchCommands('/tor').map(c => c.name)).toContain('history')
  })
  it('fecha quando não é comando ou já tem argumento', () => {
    expect(matchCommands('oi')).toEqual([])
    expect(matchCommands('/config executor')).toEqual([])
    expect(matchCommands('/zzz')).toEqual([])
  })
})

describe('comandos digitados sem barra', () => {
  it('clear, exit, sair e help viram comandos, não pedido ao time', () => {
    expect(parseCommand('clear')).toEqual({ kind: 'clear' })
    expect(parseCommand('/clear')).toEqual({ kind: 'clear' })
    expect(parseCommand('exit')).toEqual({ kind: 'exit' })
    expect(parseCommand('sair')).toEqual({ kind: 'exit' })
    expect(parseCommand('/help')).toEqual({ kind: 'help' })
    expect(parseCommand('clear o cache do redis')).toEqual({ kind: 'send', text: 'clear o cache do redis' })
  })
})

describe('/mcp', () => {
  it('abre o painel ou adiciona direto', () => {
    expect(parseCommand('/mcp')).toEqual({ kind: 'mcp' })
    expect(parseCommand('/mcp add x npx -y y')).toEqual({ kind: 'mcp', add: { nome: 'x', command: 'npx', args: ['-y', 'y'] } })
    expect(parseCommand('/mcp add')).toEqual({ kind: 'unknown', name: 'mcp add' })
  })
})

describe('/doctor', () => {
  it('é um comando', () => { expect(parseCommand('/doctor')).toEqual({ kind: 'doctor' }) })
})
