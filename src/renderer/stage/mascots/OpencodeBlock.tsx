import { RoundedBox } from '../parts/Soft'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group, Mesh } from 'three'
import { Clay } from '../materials'
import { ScreenFace } from '../parts/ScreenFace'
import { useBodyMotion } from '../parts/useBodyMotion'
import { GROUND, type BodyProps } from './types'

const DARK = '#2c2c31', LIGHT = '#d4d4da'
const W = 1.1, H = 1.1, D = 0.9, LEG_H = 0.28
const FRAME = 0.8, BAR = 0.1

/** Bloco do opencode: moldura quadrada clara com tela no rosto e antena que gira. */
export function OpencodeBlock({ frame, t }: BodyProps) {
  const upper = useRef<Group>(null)
  const tip = useRef<Mesh>(null)
  useBodyMotion(upper, frame, GROUND + LEG_H + H / 2 - 0.02)
  useFrame(() => { if (tip.current) tip.current.rotation.y += frame.current.spin })
  const z = D / 2 + 0.02
  const bars: [number, number, number, number][] = [
    [0, FRAME / 2 - BAR / 2, FRAME, BAR], [0, -FRAME / 2 + BAR / 2, FRAME, BAR],
    [-FRAME / 2 + BAR / 2, 0, BAR, FRAME], [FRAME / 2 - BAR / 2, 0, BAR, FRAME],
  ]
  return (
    <group name="body-block">
      <group ref={upper}>
        <RoundedBox args={[W, H, D]} radius={0.05} castShadow><Clay color={DARK} roughness={0.5} /></RoundedBox>
        {bars.map(([x, y, w, h], i) => (
          <RoundedBox key={i} args={[w, h, 0.06]} radius={0.015} position={[x, y, z]}><Clay color={LIGHT} roughness={0.4} /></RoundedBox>
        ))}
        <ScreenFace frame={frame} t={t} width={0.58} height={0.58} fg="#f1f1f4" position={[0, 0, z + 0.01]} />
        <RoundedBox name="antenna" args={[0.08, 0.2, 0.08]} radius={0.02} position={[0, H / 2 + 0.1, 0]}><Clay color={LIGHT} roughness={0.4} /></RoundedBox>
        <RoundedBox ref={tip} args={[0.16, 0.16, 0.16]} radius={0.03} position={[0, H / 2 + 0.26, 0]} castShadow><Clay color="#f5f5f8" roughness={0.3} /></RoundedBox>
      </group>
      {[-0.28, 0.28].map(x => (
        <RoundedBox key={x} name="leg" args={[0.18, LEG_H, 0.3]} radius={0.03} position={[x, GROUND + LEG_H / 2, 0]} castShadow><Clay color={DARK} roughness={0.5} /></RoundedBox>
      ))}
    </group>
  )
}
