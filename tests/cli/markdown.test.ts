import { describe, expect, it } from 'vitest'
import { mdLines } from '../../src/cli/markdown'

const texts = (s: string) => mdLines(s).map(l => l.text)

describe('resposta da IA formatada no terminal', () => {
  it('título em negrito colorido, com linha em branco antes', () => {
    const l = mdLines('antes\n## Resumo\ndepois')
    expect(l.map(x => x.text)).toEqual(['antes', '', 'Resumo', 'depois'])
    expect(l[2].parts?.[0]).toMatchObject({ text: 'Resumo', bold: true, color: 'cyan' })
  })
  it('listas viram marcadores alinhados; numeradas mantêm o número', () => {
    expect(texts('- um\n* dois\n  - sub\n1. primeiro\n2) segundo')).toEqual(['- um', '- dois', '  - sub', '1. primeiro', '2. segundo'])
  })
  it('**negrito** e `código` sem os símbolos, na mesma linha que quebra', () => {
    const [l] = mdLines('use **npm test** e `ls`')
    expect(l.text).toBe('use npm test e ls')
    expect(l.wrap).toBe(true)
    expect(l.parts).toEqual([{ text: 'use ' }, { text: 'npm test', bold: true }, { text: ' e ' }, { text: 'ls', color: 'cyan' }])
  })
  it('bloco de código fica recuado e cinza, sem as cercas e sem formatar', () => {
    expect(mdLines('```js\nconst **a** = 1\n```')).toEqual([{ text: '    const **a** = 1', color: 'gray' }])
  })
  it('várias linhas em branco seguidas viram uma', () => {
    expect(texts('a\n\n\n\nb')).toEqual(['a', '', 'b'])
  })
  it('citação com barra cinza e texto em itálico (com negrito dentro)', () => {
    expect(mdLines('> nota **forte**')).toEqual([{ text: '│ nota forte', wrap: true, parts: [{ text: '│ ', color: 'gray' }, { text: 'nota ', italic: true }, { text: 'forte', italic: true, bold: true }] }])
  })
  it('tabela: a linha de separação some e as células perdem o negrito cru', () => {
    expect(texts('| A | B |\n|---|---|\n| **x** | y |')).toEqual(['| A | B |', '| x | y |'])
  })
  it('modo apagado (fala do agente no meio do trabalho): tudo cinza, inclusive negrito', () => {
    const l = mdLines('use **isto** e `aquilo`', { dim: true })
    expect(l[0].parts?.every(p => p.color === 'gray')).toBe(true)
    expect(l[0].text).toBe('use isto e aquilo')
  })
})

