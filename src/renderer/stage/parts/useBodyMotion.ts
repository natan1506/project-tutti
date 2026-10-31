import { useFrame } from '@react-three/fiber'
import type { MutableRefObject, RefObject } from 'react'
import type { Group } from 'three'
import type { MotionFrame } from '../motion'

/** Aplica o quadro de movimento à parte de cima do corpo (as pernas ficam no chão). */
export function useBodyMotion(upper: RefObject<Group | null>, frame: MutableRefObject<MotionFrame>, baseY: number) {
  useFrame(() => {
    const g = upper.current
    if (!g) return
    const f = frame.current
    g.position.y = baseY + f.y
    g.rotation.z = f.rotZ
    g.scale.set(1 + (1 - f.squash) * 0.5, f.squash, 1)
  })
}
