import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group, Mesh } from 'three'
import { Clay, Ink } from '../materials'
import { Eyes } from '../parts/Eyes'
import { useBodyMotion } from '../parts/useBodyMotion'
import { GROUND, type BodyProps } from './types'

const W = 1.45, H = 0.92, D = 0.92, LEG_H = 0.34
const LEGS = [-0.55, -0.27, 0.27, 0.55]

/** Bichinho do Claude Code; Bússola usa bracinhos, Forja e Pincel usam orelhas. */
export function Clawd({ frame, color, variant }: BodyProps & { color: string; variant: 'arms' | 'ears' }) {
  const upper = useRef<Group>(null)
  const mouth = useRef<Mesh>(null)
  useBodyMotion(upper, frame, GROUND + LEG_H + H / 2 - 0.02)
  useFrame(() => { if (mouth.current) mouth.current.visible = frame.current.pose === 'working' })

  return (
    <group name="body-clawd">
      <group ref={upper}>
        <RoundedBox args={[W, H, D]} radius={0.06} castShadow><Clay color={color} /></RoundedBox>
        {variant === 'arms' && [-1, 1].map(sx => (
          <RoundedBox key={sx} name="arm" args={[0.3, 0.2, 0.34]} radius={0.04} position={[sx * (W / 2 + 0.13), -0.06, 0]} castShadow><Clay color={color} /></RoundedBox>
        ))}
        {variant === 'ears' && [-1, 1].map(sx => (
          <RoundedBox key={sx} name="ear" args={[0.2, 0.26, 0.3]} radius={0.04} position={[sx * 0.42, H / 2 + 0.12, 0]} castShadow><Clay color={color} /></RoundedBox>
        ))}
        <Eyes frame={frame} z={D / 2 + 0.01} />
        <RoundedBox ref={mouth} args={[0.3, 0.07, 0.05]} radius={0.02} position={[0, -0.24, D / 2 + 0.01]} visible={false}><Ink /></RoundedBox>
      </group>
      {LEGS.map(x => (
        <RoundedBox key={x} name="leg" args={[0.15, LEG_H, 0.3]} radius={0.03} position={[x, GROUND + LEG_H / 2, 0]} castShadow><Clay color={color} /></RoundedBox>
      ))}
    </group>
  )
}
