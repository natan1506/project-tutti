import type { UsageSnapshot, UsageSource } from '@shared/usage'

// Placar do topo (spec tutti-terminal §4): uma linha só, nome + barra cheia + percentual de cada agente da esteira.

export type CellColor = 'green' | 'yellow' | 'red' | 'gray'
export interface Cell { nome: string; text: string; color: CellColor }
export interface Placar { header: string; cells: Cell[] }

const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const GAP = 3
const MAX_BAR = 15
const MIN_BAR = 4

export function bar(pct: number, size: number): string {
  const full = Math.max(0, Math.min(size, Math.round((pct / 100) * size)))
  return '█'.repeat(full) + '░'.repeat(size - full)
}

export function colorFor(pct: number | null): CellColor {
  if (pct === null) return 'gray'
  return pct <= 60 ? 'green' : pct <= 85 ? 'yellow' : 'red'
}

function cell(nome: string, tool: UsageSource, snap: UsageSnapshot, size: number, now: number, compact = false): Cell {
  const row = snap.rows.find(r => r.tool === tool)
  const pct = row?.utilization ?? null
  if (pct === null) return { nome, text: `${'░'.repeat(size)}  —`, color: 'gray' }
  if (pct >= 100) {
    const back = row?.resetsAt && row.resetsAt > now ? ` · ${DAYS[new Date(row.resetsAt).getDay()]}` : ''
    return { nome, text: compact ? `${bar(100, size)} ✕${back.replace(' · ', '')}` : `${bar(100, size)} esgotado${back}`, color: 'red' }
  }
  const p = Math.round(pct)
  return { nome, text: `${bar(p, size)} ${`${row?.estimated ? '~' : ''}${p}%`.padStart(4)}`, color: colorFor(p) }
}

/** Largura da linha como a tela desenha: cabeçalho e células separados por 3 espaços. */
export function placarWidth(p: Placar): number {
  return [...p.header].length + p.cells.reduce((n, c) => n + GAP + [...c.nome].length + 1 + [...c.text].length, 0)
}

/** Monta o placar para caber em `width`: primeiro as barras encurtam (até 4); os nomes só encurtam em último caso. */
export function placar(header: string, agents: readonly { nome: string; tool: UsageSource }[], snap: UsageSnapshot, width: number, now: number): Placar {
  const build = (size: number, short: boolean, head = header, compact = false): Placar =>
    ({ header: head, cells: agents.map(a => cell(short ? [...a.nome].slice(0, 3).join('') : a.nome, a.tool, snap, size, now, compact)) })
  for (let size = MAX_BAR; size >= MIN_BAR; size--) {
    const p = build(size, false)
    if (placarWidth(p) <= width) return p
  }
  // Ainda não coube: na ordem, "esgotado · seg" vira "✕seg", sai o nome do projeto e, por último, os nomes encurtam.
  const bare = header.split(' · ')[0]
  for (const [short, head, compact] of [[false, header, true], [false, bare, true], [true, bare, true]] as const) {
    const p = build(MIN_BAR, short, head, compact)
    if (placarWidth(p) <= width || short) return p
  }
  return build(MIN_BAR, true, bare, true)
}
