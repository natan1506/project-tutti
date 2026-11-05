import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { useLookStore } from '../state/lookStore'
import { useProfileStore } from '../state/profileStore'
import { useSkillStore } from '../state/skillStore'
import { useVoiceStore } from '../state/voiceStore'
import { paceFor } from './pace'

const SHADOW_HZ = 8

/**
 * Comanda a cena em frameloop="demand": pede quadros só no ritmo necessário e atualiza as sombras
 * menos vezes que a imagem (cada atualização redesenha a cena inteira).
 * `tick` muda quando algo na cena mudou e pede um quadro na hora.
 */
export function RenderPace({ active, tick }: { active: boolean; tick?: unknown }) {
  const invalidate = useThree(s => s.invalidate)
  const gl = useThree(s => s.gl)
  const [hidden, setHidden] = useState(() => document.hidden)
  const [focused, setFocused] = useState(() => document.hasFocus())
  const covered = [useProfileStore(s => s.configOpen), useSkillStore(s => s.open), useVoiceStore(s => s.open), useLookStore(s => s.open)].some(Boolean)
  const fps = paceFor({ hidden, covered, focused, active })

  useEffect(() => {
    const vis = () => setHidden(document.hidden)
    const on = () => setFocused(true), off = () => setFocused(false)
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    return () => {
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
    }
  }, [])

  useEffect(() => {
    invalidate()
    if (!fps) return
    const id = setInterval(() => invalidate(), 1000 / fps)
    return () => clearInterval(id)
  }, [fps, invalidate])
  useEffect(() => { invalidate() }, [tick, invalidate])

  useEffect(() => { gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = true }, [gl])
  const frames = useRef(0)
  useFrame(() => {
    if (frames.current++ % Math.max(1, Math.round(fps / SHADOW_HZ)) === 0) gl.shadowMap.needsUpdate = true
  })
  return null
}
