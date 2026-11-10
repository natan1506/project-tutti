import { AGENTS, getAgent, type AgentId, type ToolKind } from '@shared/agents'
import { providerName } from '@shared/profiles'
import type { Confirmation, Decision, Lineup, TeamStep, Triage, TriageScore } from '@shared/team'

// Tudo que vem de modelo passa por aqui antes de virar decisão: nada inventado chega ao orquestrador.

const LINE_MAX = 80
const DECISIONS: Decision[] = ['assumo', 'assumo_com_ajuda', 'nao_e_comigo', 'sem_resposta']
const isAgent = (v: unknown, available: AgentId[]): v is AgentId => typeof v === 'string' && available.includes(v as AgentId)
const line = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, LINE_MAX) : '')
const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/** Primeiro objeto JSON do texto: bloco ```json ou chaves balanceadas. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/)
  const candidates = fenced ? [fenced[1]] : []
  const start = text.indexOf('{')
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false
    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
      if (c === '"') inStr = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) { candidates.push(text.slice(start, i + 1)); break }
    }
  }
  for (const c of candidates) {
    try { return JSON.parse(c) } catch { /* tenta o próximo */ }
  }
  return null
}

export function parseTriage(raw: unknown, available: AgentId[]): Triage | null {
  const r = record(raw)
  if (!r || !Array.isArray(r.scores)) return null
  const given = new Map<AgentId, TriageScore>()
  for (const s of r.scores) {
    const o = record(s)
    if (!o || !isAgent(o.agentId, available) || typeof o.score !== 'number') continue
    given.set(o.agentId, { agentId: o.agentId, score: Math.round(Math.min(100, Math.max(0, o.score))), line: line(o.line) })
  }
  if (!given.size) return null
  const scores = available.map(id => given.get(id) ?? { agentId: id, score: 0, line: '' })
  let candidates = [...new Set((Array.isArray(r.candidates) ? r.candidates : []).filter((c): c is AgentId => isAgent(c, available)))].slice(0, 3)
  if (!candidates.length) candidates = [...scores].sort((a, b) => b.score - a.score).filter(s => s.score >= 40).slice(0, 2).map(s => s.agentId)
  return { scores, candidates, big: r.big === true }
}

export function parseConfirmation(agentId: AgentId, text: string, ids: AgentId[] = AGENTS.map(a => a.id)): Confirmation {
  const all = ids
  const j = record(extractJson(text))
  if (j && 'decision' in j) {
    const decision = DECISIONS.includes(j.decision as Decision) ? (j.decision as Decision) : 'sem_resposta'
    return {
      agentId, decision, line: line(j.line),
      ...(isAgent(j.helper, all) ? { helper: j.helper } : {}),
      ...(isAgent(j.redirect, all) ? { redirect: j.redirect } : {}),
    }
  }
  const t = text.trim()
  const lower = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const decision: Decision = lower.startsWith('assumo') ? 'assumo' : /nao e comigo/.test(lower) ? 'nao_e_comigo' : 'sem_resposta'
  return { agentId, decision, line: line(t) }
}

const normArea = (a: string) => a.trim().replace(/^\.\//, '').replace(/\/+$/, '')

export function parseLineup(raw: unknown, available: AgentId[], allowedModels: Record<ToolKind, string[]>): Lineup | null {
  const r = record(raw)
  if (!r || !Array.isArray(r.steps)) return null
  const steps: TeamStep[] = []
  for (const s of r.steps) {
    const o = record(s)
    if (!o || !isAgent(o.agentId, available) || typeof o.task !== 'string' || !o.task.trim()) continue
    const areas = [...new Set((Array.isArray(o.areas) ? o.areas : []).filter((a): a is string => typeof a === 'string').map(normArea).filter(Boolean))]
    const agent = getAgent(o.agentId)
    // Agente por API usa o modelo do perfil; o passo só marca que é pago.
    const paid = agent.transport.kind === 'api' ? { provider: providerName(agent.transport.provider) } : undefined
    const model = !paid && typeof o.model === 'string' && allowedModels[agent.tool].includes(o.model) ? o.model : undefined
    steps.push({ agentId: o.agentId, task: o.task.trim(), ...(model ? { model } : {}), areas, ...(paid ? { paid } : {}) })
  }
  if (!steps.length) return null
  return { steps, big: r.big === true, summary: typeof r.summary === 'string' ? r.summary.trim() : '' }
}

const text = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function parseEsteiraPlan(raw: unknown): import('@shared/team').EsteiraPlan | null {
  const r = record(raw)
  const tarefa = text(r?.tarefa), pronto = text(r?.pronto, 1000), comando = text(r?.comando, 500)
  return tarefa && pronto ? { tarefa, pronto, ...(comando ? { comando } : {}) } : null
}

export function parseEsteiraReview(raw: unknown): import('@shared/team').EsteiraReview | null {
  const r = record(raw)
  if (!r || typeof r.pronto !== 'boolean') return null
  return { pronto: r.pronto, falta: text(r.falta, 2000) }
}
