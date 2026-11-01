import { getAgent, type AgentId } from '@shared/agents'
import type { RunEvent } from '@shared/events'
import type { Store } from '../store/db'

// Contexto compartilhado (spec custos-e-perfis §7): todo agente chamado na conversa sabe o que já foi dito, e por quem.

export interface ContextEntry { at: number; who: 'natan' | AgentId; kind: 'pedido' | 'resposta' | 'consulta' | 'time'; text: string }

const ENTRY_MAX = 4000
const TOOL = { claude: 'Claude Code', codex: 'Codex', gemini: 'Antigravity', opencode: 'opencode' }

/**
 * Entradas da conversa em ordem. `at` é ordinal (posição), não relógio: dois runs no mesmo milissegundo
 * não trocam de lugar. Só runs já encerrados. Entra: pedidos do Natan, respostas finais, consultas entre agentes e o resumo dos pedidos de time.
 */
export function collectEntries(store: Store, conversationId: string, excludeRunId?: string): ContextEntry[] {
  const out: ContextEntry[] = []
  const push = (who: ContextEntry['who'], kind: ContextEntry['kind'], text: string) => { if (text.trim()) out.push({ at: out.length + 1, who, kind, text: text.trim() }) }
  for (const run of store.listRuns(conversationId)) {
    // Só o que já terminou: pedido na fila ou em andamento (inclusive irmãos de uma onda) ainda não é "o que foi dito".
    if (run.id === excludeRunId || run.status === 'running') continue
    const evs: RunEvent[] = store.listEvents(run.id)
    if (!run.parentRunId) push('natan', 'pedido', run.prompt)
    const team = evs.some(e => e.type === 'team_started')
    if (team) {
      const lineup = evs.find(e => e.type === 'lineup')
      const diff = evs.filter(e => e.type === 'diff').at(-1)
      const summary = lineup?.type === 'lineup' ? lineup.lineup.summary : ''
      const files = diff?.type === 'diff' && diff.files.length ? `Arquivos alterados: ${diff.files.map(f => f.path).join(', ')}` : ''
      push('bussola', 'time', [summary, files].filter(Boolean).join('\n'))
      continue
    }
    push(run.agentId, 'resposta', evs.flatMap(e => (e.type === 'text' ? [e.text] : [])).join('\n\n'))
    for (const e of evs) {
      if (e.type !== 'agent_call_answer') continue
      const q = evs.find(x => x.type === 'agent_call' && x.to === e.to)
      push(e.from, 'consulta', `${getAgent(e.from).nome} perguntou ao ${getAgent(e.to).nome}: ${q?.type === 'agent_call' ? q.question : ''}\n${getAgent(e.to).nome}: ${e.answer}`)
    }
  }
  // Pai de time vem antes dos filhos na listagem (começou antes), o que mantém a ordem natural.
  return out
}

const label = (who: ContextEntry['who']) => {
  if (who === 'natan') return 'Natan'
  const a = getAgent(who)
  return `${a.nome} · ${TOOL[a.tool]}`
}
const cut = (t: string) => (t.length > ENTRY_MAX ? t.slice(0, ENTRY_MAX) + '…' : t)

export function buildContext(entries: ContextEntry[], opts: { forAgent: AgentId; sinceAt?: number; maxChars?: number }): string {
  const max = opts.maxChars ?? 24_000
  const chosen = opts.sinceAt === undefined ? entries : entries.filter(e => e.at > opts.sinceAt! && e.who !== opts.forAgent)
  if (!chosen.length) return ''
  const head = '### Conversa até aqui (o que o Natan e os outros agentes já disseram)'
  const lines: string[] = []
  let size = head.length + 1
  let omitted = 0
  // Das mais recentes para trás, até o teto (reservando espaço para a nota de omitidas).
  for (let i = chosen.length - 1; i >= 0; i--) {
    const e = chosen[i]
    const line = `[${e.kind === 'consulta' ? 'Consulta' : label(e.who)}] ${cut(e.text)}`
    if (size + line.length + 1 > max - 60) { omitted = i + 1; break }
    lines.unshift(line)
    size += line.length + 1
  }
  return [head, ...(omitted ? [`(… ${omitted} mensagens anteriores omitidas)`] : []), ...lines].join('\n')
}
