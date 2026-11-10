import { describe, expect, it } from 'vitest'
import { stripMouse } from '../../src/cli/mouse'

describe('roda do mouse', () => {
  it('tira os eventos de mouse do que foi digitado e diz para onde a roda girou', () => {
    expect(stripMouse('a\u001B[<64;10;5Mb\u001B[<65;10;5M\u001B[<65;1;1M')).toEqual({ rest: 'ab', wheel: [-1, 1, 1] })
  })
  it('clique e soltar o botão somem sem virar texto', () => {
    expect(stripMouse('\u001B[<0;3;4M\u001B[<0;3;4mx')).toEqual({ rest: 'x', wheel: [] })
  })
  it('texto comum passa igual', () => {
    expect(stripMouse('olá\r')).toEqual({ rest: 'olá\r', wheel: [] })
  })
})
