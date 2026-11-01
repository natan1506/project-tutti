import { agentsOfProfile, getAgent, type AgentId, type ToolKind } from '@shared/agents'
import type { UsageSnapshot } from '@shared/usage'

// Quem assume quando uma ferramenta chega no limite (spec custos-e-perfis §5).

const words = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter(w => w.length > 3))

/** Mesmo tipo (escreve/só lê), outra ferramenta com folga; menos usada primeiro, depois função mais parecida, depois ordem do elenco. */
export function pickReplacement(from: AgentId, available: AgentId[], snapshot: UsageSnapshot, alertAt: (t: ToolKind) => number): AgentId | undefined {
  const src = getAgent(from)
  const use = (t: ToolKind) => snapshot.rows.find(r => r.tool === t)?.utilization ?? 0
  // Em alerta por qualquer janela (a semanal, por exemplo) não tem folga, mesmo com a de 5 h baixa.
  const alerting = (t: ToolKind) => snapshot.rows.find(r => r.tool === t)?.alert ?? false
  const mine = words(src.funcao)
  const overlap = (id: AgentId) => [...words(getAgent(id).funcao)].filter(w => mine.has(w)).length
  return agentsOfProfile(src.profileId).map(a => a.id)
    .filter(id => id !== from && available.includes(id))
    .filter(id => { const a = getAgent(id); return a.readOnly === src.readOnly && a.tool !== src.tool && !alerting(a.tool) && use(a.tool) < alertAt(a.tool) })
    .sort((a, b) => use(getAgent(a).tool) - use(getAgent(b).tool) || overlap(b) - overlap(a))[0]
}
