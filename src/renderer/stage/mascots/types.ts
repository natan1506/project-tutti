import type { MutableRefObject } from 'react'
import type { MotionFrame } from '../motion'

/** Cada corpo lê o quadro de movimento por ref, atualizado todo quadro pelo Mascot, sem re-render. */
export interface BodyProps { frame: MutableRefObject<MotionFrame>; t: MutableRefObject<number> }

export const GROUND = -0.62
