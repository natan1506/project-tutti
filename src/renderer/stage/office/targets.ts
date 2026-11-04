import type { MascotView } from '../derive'

// Para onde cada mascote vai na sala (design §7.3), a partir do mesmo estado do palco.

export type Place = 'desk' | 'meeting' | 'coffee'
export interface TeamPhase { phase: 'meeting'; participants: string[] }

export function officeTargets(ids: readonly string[], views: Record<string, MascotView>, team: TeamPhase | undefined, coffeeAgent?: string): Record<string, Place> {
  return Object.fromEntries(ids.map(id => {
    const v = views[id]
    if (!v || v.pose === 'locked') return [id, 'desk']
    if (team?.participants.includes(id)) return [id, 'meeting']
    if (id === coffeeAgent && v.pose === 'idle' && !v.bubble) return [id, 'coffee']
    return [id, 'desk']
  })) as Record<string, Place>
}
