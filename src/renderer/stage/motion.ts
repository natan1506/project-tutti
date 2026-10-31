import type { Pose } from './derive'

// Animação de cada pose em função do tempo; valores portados do tick() de docs/mockups/tela-principal.html.

export type Expression = 'normal' | 'squint' | 'happy'
export interface MotionFrame {
  pose: Pose; y: number; rotZ: number; rotY: number; squash: number
  expression: Expression; eyeDY: number; eyeDX: number; blink: boolean; spin: number
}
export interface MotionOptions { float?: boolean; defaultExpression?: Expression; reduced?: boolean }

export const DONE_JUMP_S = 1.3

export function motionFrame(pose: Pose, t: number, phase: number, sincePose: number, opts: MotionOptions = {}): MotionFrame {
  const base = opts.defaultExpression ?? 'normal'
  const amp = pose === 'locked' ? 0.4 : 1
  const f: MotionFrame = {
    pose,
    y: Math.sin(2 * t + phase) * (opts.float ? 0.07 : 0.022) * amp,
    rotZ: 0,
    rotY: Math.sin(0.6 * t + phase) * 0.14 * amp,
    squash: 1, expression: base, eyeDY: 0, eyeDX: 0,
    blink: pose === 'idle' && (t + 2 * phase) % 4.2 < 0.12,
    spin: pose === 'thinking' ? 0.08 : pose === 'working' ? 0.15 : 0.01,
  }
  if (pose === 'thinking') {
    f.rotZ = Math.sin(3 * t + phase) * 0.07
    f.eyeDY = 0.06
    f.eyeDX = Math.sin(1.5 * t + phase) * 0.05
  } else if (pose === 'working') {
    const k = Math.abs(Math.sin(9 * t + phase))
    f.y = 0.07 * k
    f.squash = 1 - 0.04 * k
    f.rotY = Math.sin(4 * t) * 0.06
    f.expression = 'squint'
  } else if (pose === 'done') {
    f.expression = 'happy'
    if (sincePose < DONE_JUMP_S) f.y = Math.abs(Math.sin(sincePose * 7)) * 0.24 * (DONE_JUMP_S - sincePose)
  } else if (pose === 'waiting') {
    f.y = 0
    f.rotY = 0
    f.rotZ = Math.sin(6 * t) * 0.04
    f.eyeDY = 0.03
  }
  if (opts.reduced) { f.y = 0; f.rotZ = 0; f.rotY = 0; f.squash = 1 }
  return f
}

/** Rosto dos mascotes com tela de terminal (Codex e opencode). */
export function screenText(pose: Pose, t: number, blink: boolean): string {
  if (pose === 'done') return '^ ^'
  if (pose === 'waiting') return '!'
  if (pose === 'thinking') return ['.  ', '.. ', '...'][Math.floor(t * 3) % 3]
  if (pose === 'working') return Math.floor(t * 6) % 2 ? '>_' : '> '
  if (blink) return '- -'
  return Math.floor(t * 1.6) % 2 ? '>_' : '> '
}
