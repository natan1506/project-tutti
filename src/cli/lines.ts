import type { AgentId } from '@shared/agents'
import type { RunEvent } from '@shared/events'

// Como cada evento vira linha na conversa do terminal; null = não aparece (uso, eventos internos, pendências).

/** Linha da conversa; `parts` pinta pedaços com cores diferentes (`text` é a junção deles). */
export interface Line {
  text: string; color?: 'green' | 'yellow' | 'red' | 'gray' | 'cyan'; bold?: boolean
  /** Cor e negrito só na primeira linha do texto (título); o resto na cor normal. */
  head?: boolean
  /** Texto em markdown (resposta da IA): a tela formata títulos, listas, negrito e código. */
  md?: boolean
  /** Linha com `parts` que quebra na largura (as outras com `parts` são cortadas). */
  wrap?: boolean
  parts?: { text: string; color?: string; bg?: string; bold?: boolean; italic?: boolean }[]
  /** O pedido do Natan: a tela pinta com fundo cinza na largura toda. */
  prompt?: boolean
  /** Resposta do cérebro: ● na primeira linha, o resto alinhado. */
  bullet?: boolean
  /** Linha que resume as ferramentas seguidas de um pedido (vai sendo atualizada). */
  toolGroup?: { runId: string; counts: [string, number][] }
}

/** O pedido na conversa: pedido colado de 68 linhas vira as 3 primeiras e quantas faltam. */
export function promptLine(prompt: string): Line {
  const all = prompt.split('\n')
  const shown = all.slice(0, 3)
  if (all.length > 3) shown.push(`… (mais ${all.length - 3} linhas)`)
  return { text: shown.join('\n'), prompt: true }
}

const KIND_OF = (name: string): string => {
  const m = name.match(/^mcp__(.+?)__/)
  if (m) return `mcp:${m[1]}`
  if (/^(Bash|Shell)$/.test(name)) return 'cmd'
  if (name === 'Read') return 'read'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return 'edit'
  if (/^(Grep|Glob)$/.test(name)) return 'search'
  return `other:${name}`
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Rodou 3 comandos, usou linear 2 vezes, leu 1 arquivo" — como o Claude Code resume as ferramentas. */
export function toolGroupText(counts: [string, number][]): string {
  const s = counts.map(([k, n]) => {
    if (k === 'cmd') return `rodou ${plural(n, 'comando', 'comandos')}`
    if (k === 'read') return `leu ${plural(n, 'arquivo', 'arquivos')}`
    if (k === 'edit') return `editou ${plural(n, 'arquivo', 'arquivos')}`
    if (k === 'search') return `buscou ${plural(n, 'vez', 'vezes')}`
    return `usou ${k.slice(k.indexOf(':') + 1)} ${plural(n, 'vez', 'vezes')}`
  }).join(', ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function addTool(counts: [string, number][], name: string): [string, number][] {
  const k = KIND_OF(name)
  const hit = counts.find(c => c[0] === k)
  return hit ? counts.map(c => (c[0] === k ? [k, c[1] + 1] : c)) : [...counts, [k, 1]]
}

/** "5m 46s", "12s", "1h 3m". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function eventLine(ev: RunEvent, nomeDe: (id: AgentId) => string): Line | null {
  switch (ev.type) {
    case 'text': return { text: ev.text }
    case 'tool': return { text: `  · ${ev.summary}`, color: 'gray' }
    case 'notice': return { text: ev.text, color: 'yellow' }
    case 'error': return { text: `Erro: ${ev.message}`, color: 'red' }
    case 'queued': return ev.position > 0 ? { text: `Na fila (posição ${ev.position}).`, color: 'gray' } : null
    case 'esteira_plan': return { text: `## Plano${ev.volta > 1 ? ` (volta ${ev.volta})` : ''}\n${ev.plan.tarefa}\n\n**Pronto quando:** ${ev.plan.pronto}`, md: true }
    case 'esteira_swap': return { text: `↪ ${ev.reason} — ${nomeDe(ev.to)} assume`, color: 'yellow' }
    case 'esteira_review': return ev.pronto ? { text: '✓ Revisão: pronto', color: 'green' } : { text: `Revisão: falta ${ev.falta}`, color: 'yellow' }
    case 'esteira_check': {
      if (ev.ok) return { text: `✓ Verificado pelo Tutti: ${ev.command} passou`, color: 'green' }
      const tail = ev.output.trim().split('\n').slice(-6).join('\n  ')
      return { text: `✗ ${ev.command} falhou (código ${ev.exitCode})${tail ? `\n  ${tail}` : ''}`, color: 'red' }
    }
    case 'child_started': return { text: `${nomeDe(ev.agentId)}  ${ev.task}`, color: 'gray' }
    case 'diff': {
      if (!ev.files.length) return { text: 'Nenhum arquivo alterado.', color: 'gray' }
      const add = ev.files.reduce((n, f) => n + f.added, 0), rem = ev.files.reduce((n, f) => n + f.removed, 0)
      return { text: `${ev.files.length} arquivo(s) alterado(s) · +${add} −${rem}`, color: 'gray' }
    }
    case 'limit_warning': return { text: `Limite do ${ev.tool} em ${Math.round(ev.utilization)}%.`, color: 'yellow' }
    case 'run_finished':
      return ev.status === 'done' ? { text: 'Pronto.', color: 'green' }
        : ev.status === 'cancelled' ? { text: 'Cancelado.', color: 'gray' } : { text: 'Parou com erro.', color: 'red' }
    default: return null
  }
}
