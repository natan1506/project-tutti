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
  parts?: { text: string; color?: string; bg?: string; bold?: boolean }[]
}

/** O pedido na conversa: pedido colado de 68 linhas vira as 3 primeiras e quantas faltam. */
export function promptLine(prompt: string): Line {
  const all = prompt.split('\n')
  const shown = all.slice(0, 3).map((l, i) => (i ? `  ${l}` : `› ${l}`))
  if (all.length > 3) shown.push(`  … (mais ${all.length - 3} linhas)`)
  return { text: shown.join('\n'), color: 'cyan', bold: true, head: true }
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
