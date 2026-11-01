import { PADRAO, resolveAgentDefs, type Family, type Transport } from './profiles'

/** Id de agente de qualquer perfil; os do Padrão continuam 'bussola', 'forja'… (histórico antigo segue valendo). */
export type AgentId = string
export type ToolKind = 'claude' | 'codex' | 'gemini' | 'opencode'

export interface AgentDef {
  id: AgentId
  nome: string
  /** Ferramenta que roda o agente: a do CLI, ou 'opencode' para agentes por API. */
  tool: ToolKind
  funcao: string
  persona: string
  defaultModel?: string
  readOnly: boolean
  transport: Transport
  family: Family
  /** Ordem do agente dentro da família no perfil (0, 1, 2…), para variar o tom da cor. */
  shade: number
  profileId: string
  reviewer: boolean
  consultable: boolean
  coordinator: boolean
}

/** Agentes do perfil Padrão (o time de sempre). */
export const AGENTS: readonly AgentDef[] = resolveAgentDefs(PADRAO)

// Registro de todos os agentes conhecidos (de todos os perfis), para conversas de qualquer perfil abrirem.
const registry = new Map<AgentId, AgentDef>(AGENTS.map(a => [a.id, a]))

/** Troca os agentes de um perfil pelos novos (os outros perfis ficam como estão). */
export function registerAgents(defs: AgentDef[]): void {
  const profiles = new Set(defs.map(d => d.profileId))
  for (const [id, d] of registry) if (profiles.has(d.profileId)) registry.delete(id)
  for (const d of defs) registry.set(d.id, d)
}

/** Tira todos os agentes de um perfil do registro. */
export function unregisterProfile(profileId: string): void {
  for (const [id, d] of registry) if (d.profileId === profileId) registry.delete(id)
}

export const knownAgent = (id: AgentId): boolean => registry.has(id)

export function getAgent(id: AgentId): AgentDef {
  return registry.get(id) ?? {
    id, nome: 'Agente (removido)', tool: 'opencode', funcao: '', persona: '', readOnly: true,
    transport: { kind: 'cli', tool: 'opencode' }, family: 'other', shade: 0, profileId: '', reviewer: false, consultable: false, coordinator: false,
  }
}
