import { RoundedBox as DreiRoundedBox } from '@react-three/drei'
import { forwardRef, type ComponentProps } from 'react'
import type { Mesh } from 'three'

/** RoundedBox com menos triângulos: o canto arredondado fica igual nesse tamanho de tela e pesa bem menos. */
export const RoundedBox = forwardRef<Mesh, ComponentProps<typeof DreiRoundedBox>>((props, ref) => (
  <DreiRoundedBox ref={ref} smoothness={2} bevelSegments={1} {...props} />
))
RoundedBox.displayName = 'RoundedBox'
