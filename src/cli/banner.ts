import { ICON_PIXELS } from './iconPixels'
import type { Line } from './lines'

// Tela de entrada do `tutti`: numa moldura arredondada, o ícone do app em pixels (dois por caractere, com meio-bloco)
// e "TUTTI" em letras grossas no gradiente do app (roxo #8b6cf6 → azul #4f8df7 → ciano #3fd8ee); embaixo, o time.

type Part = { text: string; color?: string; bg?: string }
const part = (text: string, color?: string, bg?: string): Part => ({ text, ...(color ? { color } : {}), ...(bg ? { bg } : {}) })

const ACCENT = '#8b6cf6', LILAS = '#a996ff', TEXT = '#ecebfa', MUTED = '#8e8bb5'
/** Cor de cada agente no app (styles.css); quem não está aqui usa o lilás. */
const AGENT_COLOR: Record<string, string> = { Bússola: '#d97757', Forja: '#c9643f', Pincel: '#e2b56f', Radar: '#8a7cf0', Lupa: '#3d6df2', Curinga: '#b9b9c2' }

const FONT: Record<string, string[]> = {
  T: ['########', '########', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...'],
  U: ['##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '########', '.######.'],
  I: ['####', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '####'],
}

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const mix = (a: string, b: string, t: number) =>
  `#${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
/** Gradiente do app: 0 → roxo, 0,55 → azul, 1 → ciano. */
export function gradient(t: number): string {
  return t <= 0.55 ? mix(ACCENT, '#4f8df7', t / 0.55) : mix('#4f8df7', '#3fd8ee', (t - 0.55) / 0.45)
}

/** Grade de pixels (cor ou null) → linhas de meio-bloco: cima = cor do texto, baixo = fundo. */
function halfBlocks(px: (string | null)[][]): Part[][] {
  const rows: Part[][] = []
  for (let y = 0; y < px.length; y += 2) {
    rows.push(px[y].map((top, x) => {
      const bottom = px[y + 1]?.[x] ?? null
      if (!top && !bottom) return part(' ')
      if (top && !bottom) return part('▀', top)
      if (!top && bottom) return part('▄', bottom)
      return top === bottom ? part('█', top!) : part('▀', top!, bottom!)
    }))
  }
  return rows
}

function wordmark(): Part[][] {
  const letters = ['T', 'U', 'T', 'T', 'I'].map(c => FONT[c])
  const grid = Array.from({ length: 8 }, (_, y) => letters.map(l => l[y]).join('..'))
  const w = grid[0].length
  return halfBlocks(grid.map(r => [...r].map((c, x) => (c === '#' ? gradient(x / (w - 1)) : null))))
}

const len = (ps: Part[]) => ps.reduce((n, x) => n + [...x.text].length, 0)
const lineOf = (parts: Part[]): Line => ({ text: parts.map(x => x.text).join(''), parts })

/** Corta linhas e colunas vazias em volta; altura par (dois pixels por caractere). */
function crop(px: (string | null)[][]): (string | null)[][] {
  const rows = px.filter(r => r.some(Boolean))
  const used = (x: number) => rows.some(r => r[x])
  let a = 0, b = rows[0].length - 1
  while (a < b && !used(a)) a++
  while (b > a && !used(b)) b--
  const out = rows.map(r => r.slice(a, b + 1))
  return out.length % 2 ? [...out, out[0].map(() => null)] : out
}

export function bannerLines(o: { version: string; project: string; team: { nome: string; tool: string; papel: string }[] }): Line[] {
  const icon = halfBlocks(crop(ICON_PIXELS))
  const word = wordmark()
  const right: Part[][] = Array.from({ length: icon.length }, () => [])
  // TUTTI, versão e frase centralizados na altura do ícone.
  const at = Math.max(0, Math.floor((icon.length - 7) / 2))
  word.forEach((r, i) => { right[at + i] = r })
  right[at + 5] = [part(`v${o.version || '?'}`, LILAS), part('  ·  ', MUTED), part(o.project, TEXT)]
  right[at + 6] = [part('Time de agentes no terminal', MUTED)]
  const inner = 1 + icon[0].length + 2 + Math.max(...right.map(len)) + 1
  const top = lineOf([part(`╭${'─'.repeat(inner)}╮`, ACCENT)])
  const bottom = lineOf([part(`╰${'─'.repeat(inner)}╯`, ACCENT)])
  const body = icon.map((ic, i) => {
    const r = right[i]
    return lineOf([part('│', ACCENT), part(' '), ...ic, part('  '), ...r, part(' '.repeat(inner - 1 - ic.length - 2 - len(r))), part('│', ACCENT)])
  })
  const team = o.team.length
    ? o.team.map(a => lineOf([part('  ● ', AGENT_COLOR[a.nome] ?? LILAS), part(a.nome, AGENT_COLOR[a.nome] ?? LILAS), part(` (${a.tool}) ${a.papel}`, MUTED)]))
    : [{ text: '  Use /config perfil Trabalho para ligar a esteira.', color: 'yellow' as const }]
  return [
    top, ...body, bottom,
    { text: '' },
    ...team,
    { text: '' },
    { text: '  Escreva o pedido e Enter  ·  / abre os comandos  ·  /config papéis  ·  /help', color: 'gray' },
    { text: '' },
  ]
}
