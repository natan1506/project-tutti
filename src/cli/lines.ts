import type { AgentId } from '@shared/agents'
import type { RunEvent } from '@shared/events'

// Como cada evento vira linha na conversa do terminal; null = não aparece (uso, eventos internos, pendências).

export interface Line { text: string; color?: 'green' | 'yellow' | 'red' | 'gray' | 'cyan' }

export function eventLine(ev: RunEvent, nomeDe: (id: AgentId) => string): Line | null {
  switch (ev.type) {
    case 'text': return { text: ev.text }
    case 'tool': return { text: `  · ${ev.summary}`, color: 'gray' }
    case 'notice': return { text: ev.text, color: 'yellow' }
    case 'error': return { text: `Erro: ${ev.message}`, color: 'red' }
    case 'queued': return ev.position > 0 ? { text: `Na fila (posição ${ev.position}).`, color: 'gray' } : null
    case 'esteira_plan': return { text: `Plano: ${ev.plan.tarefa}\n  Pronto quando: ${ev.plan.pronto}`, color: 'cyan' }
    case 'esteira_swap': return { text: `↪ ${ev.reason} — ${nomeDe(ev.to)} assume`, color: 'yellow' }
    case 'esteira_review': return ev.pronto ? { text: '✓ Revisão: pronto', color: 'green' } : { text: `Revisão: falta ${ev.falta}`, color: 'yellow' }
    case 'child_started': return { text: `${nomeDe(ev.agentId)}  ${ev.task}` }
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
