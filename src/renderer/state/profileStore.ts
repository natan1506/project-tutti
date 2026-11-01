import { create } from 'zustand'
import { registerAgents, type AgentDef, type AgentId } from '@shared/agents'
import { PADRAO, resolveAgentDefs, type Profile } from '@shared/profiles'

// Perfil ativo do projeto aberto e a disponibilidade de cada agente dele (spec custos-e-perfis §6).

export type AgentAvailability = Record<AgentId, { ok: boolean; hint?: string }>

interface ProfileState {
  profiles: Profile[]
  active: Profile
  status: AgentAvailability
  configOpen: boolean
  load(projectId: string): Promise<void>
  setProfiles(profiles: Profile[]): void
  setActive(projectId: string, profileId: string): Promise<void>
  openConfig(open: boolean): void
}

/** Registra os agentes de todos os perfis, para conversas de qualquer perfil mostrarem nomes certos. */
function register(profiles: Profile[]): void {
  for (const p of profiles) registerAgents(resolveAgentDefs(p))
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [PADRAO],
  active: PADRAO,
  status: {},
  configOpen: false,

  async load(projectId) {
    const [profiles, active, status] = await Promise.all([
      window.time.profiles(), window.time.activeProfile(projectId), window.time.agentStatus(projectId),
    ])
    register(profiles)
    set({ profiles, active, status })
  },

  setProfiles(profiles) {
    register(profiles)
    const active = profiles.find(p => p.id === get().active.id) ?? PADRAO
    set({ profiles, active })
  },

  async setActive(projectId, profileId) {
    await window.time.setActiveProfile(projectId, profileId)
    await get().load(projectId)
  },

  openConfig: configOpen => set({ configOpen }),
}))

/** Agentes do perfil ativo, na ordem do perfil. */
export const activeAgents = (p: Profile): AgentDef[] => resolveAgentDefs(p)
