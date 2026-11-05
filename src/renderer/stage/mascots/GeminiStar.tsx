import { RoundedBox } from '../parts/Soft'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, ExtrudeGeometry, Float32BufferAttribute, Shape, type Group } from 'three'
import { Clay } from '../materials'
import { useBodyMotion } from '../parts/useBodyMotion'
import { GROUND, type BodyProps } from './types'

/** Estrela de 4 pontas extrudada, com gradiente azul → roxo → rosa pintado por vértice. */
function starGeometry(): ExtrudeGeometry {
  const s = new Shape(), k = 0.14
  s.moveTo(0, 1); s.quadraticCurveTo(k, k, 1, 0); s.quadraticCurveTo(k, -k, 0, -1)
  s.quadraticCurveTo(-k, -k, -1, 0); s.quadraticCurveTo(-k, k, 0, 1)
  const g = new ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.06, bevelSegments: 2, curveSegments: 12 })
  g.center()
  const pos = g.attributes.position, col: number[] = [], c = new Color()
  const A = new Color('#4a8cf7'), B = new Color('#9b72e8'), C = new Color('#e96b8a')
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getX(i) - pos.getY(i) + 1.2) / 2.4))
    if (t < 0.5) c.lerpColors(A, B, t * 2)
    else c.lerpColors(B, C, (t - 0.5) * 2)
    col.push(c.r, c.g, c.b)
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  return g
}

export function GeminiStar({ frame, t }: BodyProps) {
  const upper = useRef<Group>(null)
  const spinner = useRef<Group>(null)
  const eyes = useRef<Group>(null)
  const geometry = useMemo(starGeometry, [])
  useBodyMotion(upper, frame, GROUND + 1.05)
  useFrame(() => {
    const f = frame.current
    if (spinner.current) spinner.current.rotation.y = f.pose === 'working' ? t.current * 4 : Math.sin(t.current * 0.8) * 0.4
    eyes.current?.children.forEach(e => {
      e.scale.y = f.blink ? 0.12 : f.expression === 'happy' ? 0.45 : 1
      e.position.y = 0.02 + f.eyeDY
    })
  })
  return (
    <group name="body-star">
      <group ref={upper}>
        <group ref={spinner}>
          <mesh geometry={geometry} scale={0.8} castShadow><Clay color="#ffffff" roughness={0.32} vertexColors /></mesh>
          <group ref={eyes}>
            {[-0.08, 0.08].map(x => (
              <RoundedBox key={x} args={[0.07, 0.18, 0.04]} radius={0.02} position={[x, 0.02, 0.23]}><Clay color="#f3f0ff" roughness={0.3} /></RoundedBox>
            ))}
          </group>
        </group>
      </group>
    </group>
  )
}
