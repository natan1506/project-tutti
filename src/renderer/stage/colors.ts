import type { AgentDef } from '@shared/agents'
import type { Family } from '@shared/profiles'

// Cor do agente = cor da família do modelo, com tom variando entre agentes da mesma família (spec custos-e-perfis §6).

const BASE: Record<Family, string> = { claude: '#d97757', gpt: '#3d6df2', gemini: '#8a7cf0', other: '#b9b9c2' }
/** Os três primeiros tons do Claude são os do Padrão (Bússola, Forja, Pincel). */
const CLAUDE_TONES = ['#d97757', '#c9643f', '#e2b56f']

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

/** Tom 0 = a própria cor; ímpares clareiam, pares escurecem, 12% por degrau. */
export function shadeColor(base: string, shade: number): string {
  if (shade <= 0) return base
  const step = Math.ceil(shade / 2) * 0.12
  const lighter = shade % 2 === 1
  const [r, g, b] = [1, 3, 5].map(i => parseInt(base.slice(i, i + 2), 16))
  const mix = (c: number) => (lighter ? c + (255 - c) * step : c * (1 - step))
  return `#${hex(mix(r))}${hex(mix(g))}${hex(mix(b))}`
}

export function agentColor(a: Pick<AgentDef, 'family' | 'shade'>): string {
  if (a.family === 'claude' && a.shade < CLAUDE_TONES.length) return CLAUDE_TONES[a.shade]
  return shadeColor(BASE[a.family], a.family === 'claude' ? a.shade - CLAUDE_TONES.length + 1 : a.shade)
}
