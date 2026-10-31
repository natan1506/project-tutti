import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'
import { DimContext } from '../materials'
import { screenText, type MotionFrame } from '../motion'

/** Rosto de terminal desenhado num canvas 2D que vira textura; só redesenha quando o texto muda. */
export function ScreenFace({ frame, t, width, height, fg, bg, position }: {
  frame: MutableRefObject<MotionFrame>; t: MutableRefObject<number>
  width: number; height: number; fg: string; bg?: string; position: [number, number, number]
}) {
  const dim = useContext(DimContext)
  const { canvas, texture } = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = Math.round((256 * height) / width)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return { canvas, texture }
  }, [width, height])
  useEffect(() => () => texture.dispose(), [texture])
  const last = useRef('')

  useFrame(() => {
    const f = frame.current
    const text = screenText(f.pose, t.current, f.blink)
    if (text === last.current) return
    last.current = text
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height) }
    ctx.fillStyle = fg
    ctx.font = `bold ${Math.round(canvas.height * 0.62)}px ui-monospace, Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4)
    texture.needsUpdate = true
  })

  return (
    <mesh name="screen-face" position={position}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent opacity={dim ? 0.45 : 1} />
    </mesh>
  )
}
