import { knownAgent } from '@shared/agents'
import { isLook, type Look } from '@shared/look'

// Aparência dos mascotes por agente (fora do perfil, como as vozes): um mapa só em `settings`.

export function lookHandlers(store: { getSetting<T>(k: string): T | undefined; setSetting(k: string, v: unknown): void }) {
  const all = () => store.getSetting<Record<string, Look>>('looks') ?? {}
  return {
    looks: () => all(),
    setLook: (arg: unknown) => {
      const { agentId, look } = (arg ?? {}) as { agentId?: unknown; look?: unknown }
      if (typeof agentId !== 'string' || !knownAgent(agentId)) throw new Error('Agente inválido')
      if (look !== null && !isLook(look)) throw new Error('Aparência inválida')
      const next = { ...all() }
      if (look === null) delete next[agentId]
      else next[agentId] = look
      store.setSetting('looks', next)
      return next
    },
  }
}
