import type { Family } from './profiles'

// Aparência do mascote (estilo do vídeo do Estúdio): corpo, cor e olhos por agente, fora do perfil.

export type Body = 'clawd-arms' | 'clawd-ears' | 'star' | 'cloud' | 'block'
export type Eyes = 'normal' | 'squint' | 'happy'
export const BODIES: readonly { id: Body; nome: string }[] = [
  { id: 'clawd-ears', nome: 'Claude (orelhas)' }, { id: 'clawd-arms', nome: 'Claude (bracinhos)' },
  { id: 'cloud', nome: 'Nuvem (Codex)' }, { id: 'star', nome: 'Estrela (Antigravity)' }, { id: 'block', nome: 'Bloco (opencode)' },
]
export const EYES: readonly { id: Eyes; nome: string }[] = [{ id: 'normal', nome: 'Normal' }, { id: 'squint', nome: 'Concentrado' }, { id: 'happy', nome: 'Feliz' }]
export const SWATCHES = ['#d97757', '#c9643f', '#e2b56f', '#8b6cf6', '#3fd8ee', '#3d6df2', '#3ecf8e', '#f472b6', '#f5a524', '#b9b9c2']

export interface Look { body?: Body; color?: string; eyes?: Eyes }
export interface ResolvedLook { body: Body; color: string; eyes: Eyes }

export function defaultBody(a: { family: Family; coordinator: boolean }): Body {
  if (a.family === 'claude') return a.coordinator ? 'clawd-arms' : 'clawd-ears'
  return a.family === 'gpt' ? 'cloud' : a.family === 'gemini' ? 'star' : 'block'
}

export function resolveLook(a: { family: Family; coordinator: boolean }, color: string, look: Look | undefined, eyes: Eyes = 'normal'): ResolvedLook {
  return { body: look?.body ?? defaultBody(a), color: look?.color ?? color, eyes: look?.eyes ?? eyes }
}

export function isLook(v: unknown): v is Look {
  if (!v || typeof v !== 'object') return false
  const l = v as Record<string, unknown>
  return (l.body === undefined || BODIES.some(b => b.id === l.body))
    && (l.color === undefined || (typeof l.color === 'string' && /^#[0-9a-f]{6}$/i.test(l.color)))
    && (l.eyes === undefined || EYES.some(e => e.id === l.eyes))
}
