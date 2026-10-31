import { getAgent } from '@shared/agents'
import type { Lineup, TeamStep } from '@shared/team'

// Spec §6.2: paralelo só com áreas de arquivo disjuntas; spec §5.3: o que conta como pedido grande.

export const STRUCTURAL: RegExp[] = [
  /(^|\/)package\.json$/, /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/,
  /(^|\/)tsconfig[^/]*\.json$/, /(^|\/)[^/]+\.config\.[cm]?[jt]s$/, /(^|\/)\.env[^/]*$/,
  /(^|\/)(migrations|prisma)(\/|$)/, /(^|\/)Dockerfile$/,
]

const within = (a: string, b: string) => a === b || a.startsWith(b + '/')

/** Área vazia ou `*` = "não sei onde mexo", que se cruza com tudo. */
export function areasOverlap(a: string[], b: string[]): boolean {
  if (!a.length || !b.length || a.includes('*') || b.includes('*')) return true
  return a.some(x => b.some(y => within(x, y) || within(y, x)))
}

const writes = (s: TeamStep) => !getAgent(s.agentId).readOnly

export function buildWaves(steps: TeamStep[]): number[][] {
  const waves: number[][] = []
  steps.forEach((s, i) => {
    const last = waves.at(-1)
    const fits = last
      && !last.some(j => steps[j].agentId === s.agentId)
      && (writes(s)
        ? !last.some(j => writes(steps[j]) && areasOverlap(steps[j].areas, s.areas))
        // Revisão só depois de quem escreveu; pesquisa pode correr junto.
        : s.agentId !== 'lupa' || !last.some(j => writes(steps[j])))
    if (fits) last.push(i)
    else waves.push([i])
  })
  return waves
}

export function isBig(lineup: Lineup, forced: boolean): boolean {
  if (forced || lineup.big) return true
  const areas = new Set(lineup.steps.flatMap(s => s.areas))
  return areas.size > 3 || [...areas].some(a => STRUCTURAL.some(r => r.test(a)))
}
