import { RoundedBox } from '../parts/Soft'
import { useRef } from 'react'
import type { Group } from 'three'
import { Clay } from '../materials'
import { ScreenFace } from '../parts/ScreenFace'
import { useBodyMotion } from '../parts/useBodyMotion'
import { GROUND, type BodyProps } from './types'

const BLUE = '#3d6df2'
const PUFFS: [number, number, number, number][] = [
  [0, 0, 0, 0.5], [-0.42, -0.06, 0, 0.38], [0.42, -0.06, 0, 0.38], [-0.2, 0.3, -0.05, 0.36], [0.22, 0.28, -0.05, 0.38],
  [0, -0.2, 0.02, 0.44], [-0.6, -0.26, -0.05, 0.27], [0.6, -0.26, -0.05, 0.27], [-0.32, -0.36, 0.05, 0.3], [0.32, -0.36, 0.05, 0.3],
]

/** Nuvem do Codex com tela de terminal no lugar do rosto e um corpinho com mini tela. */
export function CodexCloud({ frame, t }: BodyProps) {
  const upper = useRef<Group>(null)
  useBodyMotion(upper, frame, GROUND + 0.24 + 0.59)
  return (
    <group name="body-cloud">
      <group ref={upper}>
        <group position={[0, 0.32, 0]}>
          {PUFFS.map(([x, y, z, r], i) => (
            <mesh key={i} position={[x, y, z]} castShadow><sphereGeometry args={[r, 18, 12]} /><Clay color={BLUE} roughness={0.45} /></mesh>
          ))}
          <RoundedBox args={[0.78, 0.5, 0.1]} radius={0.06} position={[0, -0.03, 0.47]}><Clay color="#0d2a8a" roughness={0.3} /></RoundedBox>
          <ScreenFace frame={frame} t={t} width={0.68} height={0.4} fg="#dbe6ff" bg="#0a1f6e" position={[0, -0.03, 0.525]} />
        </group>
        <RoundedBox args={[0.56, 0.42, 0.42]} radius={0.1} position={[0, -0.38, 0]} castShadow><Clay color={BLUE} roughness={0.45} /></RoundedBox>
        <ScreenFace frame={frame} t={t} width={0.3} height={0.16} fg="#dbe6ff" bg="#0d2a8a" position={[0, -0.38, 0.215]} />
      </group>
      {[-0.14, 0.14].map(x => (
        <RoundedBox key={x} name="leg" args={[0.14, 0.24, 0.2]} radius={0.03} position={[x, GROUND + 0.12, 0]} castShadow><Clay color={BLUE} roughness={0.45} /></RoundedBox>
      ))}
    </group>
  )
}
