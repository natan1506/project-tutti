import { PassThrough } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

// Roda do mouse na tela cheia. Sem isto o terminal transforma a roda em ↑/↓, que mexem na opção escolhida. Com o
// relato de mouse ligado (SGR), a roda chega como evento: o Tutti rola a conversa e as setas ficam só para escolher.

// eslint-disable-next-line no-control-regex
const SGR_MOUSE = /\u001B\[<(\d+);\d+;\d+[Mm]/g

/** Separa os eventos de mouse do resto; roda para cima = -1, para baixo = 1; cliques são descartados. */
export function stripMouse(s: string): { rest: string; wheel: number[] } {
  const wheel: number[] = []
  const rest = s.replace(SGR_MOUSE, (_, b: string) => {
    const code = Number(b)
    if ((code & 64) && !(code & 32)) wheel.push(code & 1 ? 1 : -1)
    return ''
  })
  return { rest, wheel }
}

export const MOUSE_ON = '\u001B[?1000h\u001B[?1006h'
export const MOUSE_OFF = '\u001B[?1000l\u001B[?1006l'

/** Entrada para o Ink sem os eventos de mouse; a roda vai para `onWheel`. */
export function wheelStdin(stdin: NodeJS.ReadStream): { stdin: NodeJS.ReadStream; onWheel(fn: (d: number) => void): () => void } {
  const fns = new Set<(d: number) => void>()
  const out = new PassThrough() as unknown as NodeJS.ReadStream & { isTTY: boolean }
  out.isTTY = true
  out.setRawMode = (mode: boolean) => { stdin.setRawMode(mode); return out }
  out.ref = () => { stdin.ref(); return out }
  out.unref = () => { stdin.unref(); return out }
  const dec = new StringDecoder('utf8')
  stdin.on('data', (chunk: Buffer) => {
    const { rest, wheel } = stripMouse(dec.write(chunk))
    for (const d of wheel) fns.forEach(f => f(d))
    if (rest) (out as unknown as PassThrough).write(rest)
  })
  return { stdin: out, onWheel: fn => { fns.add(fn); return () => { fns.delete(fn) } } }
}
