import { randomUUID } from 'node:crypto'
import { getAgent, registerAgents, type AgentDef } from '@shared/agents'
import { PADRAO, resolveAgentDefs, TRABALHO_SEED, validateProfile, type Profile } from '@shared/profiles'
import type { Store } from '../store/db'

// Spec custos-e-perfis §6: perfis do Natan no banco, o Padrão fixo; cada projeto lembra o último perfil.

const REMOVED_KEY = 'removedAgents'

export class ProfileService {
  constructor(private deps: { store: Store; emit: (profiles: Profile[]) => void }) {
    // Agentes de perfis apagados continuam com nome, para conversas antigas abrirem.
    registerAgents(deps.store.getSetting<AgentDef[]>(REMOVED_KEY) ?? [])
    for (const p of deps.store.listProfiles()) registerAgents(resolveAgentDefs(p))
  }

  /** Relê os perfis do banco (o app pode ter editado enquanto o terminal estava aberto). */
  reload(): void {
    for (const p of this.deps.store.listProfiles()) registerAgents(resolveAgentDefs(p))
  }

  all(): Profile[] {
    return [PADRAO, ...this.deps.store.listProfiles()]
  }

  get(id: string): Profile | undefined {
    return this.all().find(p => p.id === id)
  }

  save(raw: unknown): { ok: true; profile: Profile } | { ok: false; errors: string[] } {
    const v = validateProfile(raw)
    if (!v.ok) return v
    if (v.profile.id === PADRAO.id) return { ok: false, errors: ['O perfil Padrão não pode ser editado; duplique para mudar.'] }
    const id = v.profile.id && this.deps.store.listProfiles().some(p => p.id === v.profile.id) ? v.profile.id : `p_${randomUUID()}`
    const idMap = new Map<string, string>()
    const agents = v.profile.agents.map(a => {
      const known = a.id && getAgent(a.id).profileId === id
      const next = known ? a.id : `a_${randomUUID()}`
      idMap.set(a.id, next)
      return { ...a, id: next }
    })
    const coordinatorId = v.profile.coordinatorId === undefined ? undefined : idMap.get(v.profile.coordinatorId)
    const e = v.profile.esteira
    // A esteira segue os ids novos dos agentes (renomeados ou recriados).
    const esteira = e && {
      cerebro: idMap.get(e.cerebro)!, executor: idMap.get(e.executor)!, tester: idMap.get(e.tester)!,
      ...(e.reserva ? { reserva: idMap.get(e.reserva)! } : {}), maxVoltas: e.maxVoltas,
    }
    const profile: Profile = { ...v.profile, id, builtin: false, agents, ...(coordinatorId ? { coordinatorId } : {}), ...(esteira ? { esteira } : {}) }
    if (!coordinatorId) delete profile.coordinatorId
    if (!esteira) delete profile.esteira
    this.deps.store.saveProfile(profile)
    registerAgents(resolveAgentDefs(profile))
    this.changed()
    return { ok: true, profile }
  }

  duplicate(id: string, nome?: string): Profile {
    const src = this.get(id)
    if (!src) throw new Error('PROFILE_NOT_FOUND')
    const r = this.save({ ...src, id: '', builtin: false, nome: nome?.trim() || `${src.nome} (cópia)`, agents: src.agents.map(a => ({ ...a })) })
    if (!r.ok) throw new Error(r.errors.join(' '))
    return r.profile
  }

  remove(id: string): void {
    if (id === PADRAO.id) throw new Error('O perfil Padrão não pode ser apagado.')
    const p = this.deps.store.listProfiles().find(x => x.id === id)
    if (!p) return
    const removed = [...(this.deps.store.getSetting<AgentDef[]>(REMOVED_KEY) ?? []),
      ...resolveAgentDefs(p).map(d => ({ ...d, nome: `${d.nome} (removido)`, profileId: `removido:${id}` }))]
    this.deps.store.setSetting(REMOVED_KEY, removed)
    this.deps.store.deleteProfile(id)
    registerAgents(removed)
    this.changed()
  }

  /** Agentes de perfis apagados (nome com "(removido)"), para conversas antigas na interface. */
  removedAgents(): AgentDef[] {
    return this.deps.store.getSetting<AgentDef[]>(REMOVED_KEY) ?? []
  }

  /** Cria o perfil Trabalho uma vez (spec tutti-terminal §7); apagado pelo Natan, não volta. */
  seedTrabalho(): Profile | undefined {
    if (this.deps.store.getSetting<boolean>('seed:trabalho')) return undefined
    this.deps.store.setSetting('seed:trabalho', true)
    const r = this.save({ ...TRABALHO_SEED, agents: TRABALHO_SEED.agents.map(a => ({ ...a })) })
    if (!r.ok) throw new Error(r.errors.join(' '))
    return r.profile
  }

  activeFor(projectId: string): Profile {
    const id = this.deps.store.getSetting<string>(`profile:${projectId}`)
    return (id && this.get(id)) || PADRAO
  }

  setActive(projectId: string, profileId: string): void {
    if (!this.get(profileId)) throw new Error('PROFILE_NOT_FOUND')
    this.deps.store.setSetting(`profile:${projectId}`, profileId)
  }

  private changed(): void {
    this.deps.emit(this.all())
  }
}
