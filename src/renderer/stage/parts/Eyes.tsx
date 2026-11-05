import { RoundedBox } from './Soft'
import { useFrame } from '@react-three/fiber'
import { useRef, type MutableRefObject } from 'react'
import type { Group } from 'three'
import { Ink } from '../materials'
import type { Expression, MotionFrame } from '../motion'

const POP_S = 0.12

function Stroke({ w, h, x = 0, y = 0, rot = 0 }: { w: number; h: number; x?: number; y?: number; rot?: number }) {
  return <RoundedBox args={[w, h, 0.05]} radius={0.02} position={[x, y, 0]} rotation={[0, 0, rot]}><Ink /></RoundedBox>
}

/** Um olho com as três expressões; `side` espelha o `> <`. */
function Eye({ x, side }: { x: number; side: 1 | -1 }) {
  return (
    <group position={[x, 0, 0]} name="eye">
      <group name="eye-normal"><Stroke w={0.13} h={0.26} /></group>
      <group name="eye-squint"><Stroke w={0.19} h={0.06} y={0.05} rot={side * 0.6} /><Stroke w={0.19} h={0.06} y={-0.05} rot={-side * 0.6} /></group>
      <group name="eye-happy"><Stroke w={0.16} h={0.06} x={-0.05} rot={0.7} /><Stroke w={0.16} h={0.06} x={0.05} rot={-0.7} /></group>
    </group>
  )
}

export function Eyes({ frame, y = 0.04, z, spacing = 0.25 }: { frame: MutableRefObject<MotionFrame>; y?: number; z: number; spacing?: number }) {
  const root = useRef<Group>(null)
  const shown = useRef<{ expr?: Expression; since: number }>({ since: 0 })
  useFrame(({ clock }) => {
    const g = root.current
    if (!g) return
    const f = frame.current
    if (f.expression !== shown.current.expr) shown.current = { expr: f.expression, since: clock.elapsedTime }
    // A expressão nova entra crescendo em ~120 ms; a antiga some na hora.
    const pop = Math.min(1, 0.4 + 0.6 * ((clock.elapsedTime - shown.current.since) / POP_S))
    g.traverse(o => {
      if (!o.name.startsWith('eye-')) return
      const on = o.name === `eye-${f.expression}`
      o.visible = on
      if (!on) return
      o.scale.setScalar(pop)
      if (o.name === 'eye-normal') {
        o.scale.y = f.blink ? 0.12 : pop
        o.position.set(f.eyeDX, f.eyeDY, 0)
      }
    })
  })
  return (
    <group ref={root} position={[0, y, z]}>
      <Eye x={-spacing} side={1} />
      <Eye x={spacing} side={-1} />
    </group>
  )
}
