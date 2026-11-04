import { describe, expect, it } from 'vitest'
import { defaultBody, isLook, resolveLook } from '../../src/shared/look'

describe('aparência do mascote', () => {
  it('corpo padrão segue a família; coordenador Claude tem bracinhos', () => {
    expect(defaultBody({ family: 'claude', coordinator: true })).toBe('clawd-arms')
    expect(defaultBody({ family: 'claude', coordinator: false })).toBe('clawd-ears')
    expect(defaultBody({ family: 'gpt', coordinator: false })).toBe('cloud')
    expect(defaultBody({ family: 'gemini', coordinator: false })).toBe('star')
    expect(defaultBody({ family: 'other', coordinator: false })).toBe('block')
  })
  it('o que o Natan escolheu vence o padrão; o resto fica no padrão', () => {
    expect(resolveLook({ family: 'gpt', coordinator: false }, '#3d6df2', { eyes: 'happy' }))
      .toEqual({ body: 'cloud', color: '#3d6df2', eyes: 'happy' })
    expect(resolveLook({ family: 'claude', coordinator: false }, '#c9643f', { body: 'star', color: '#22cc88' }))
      .toEqual({ body: 'star', color: '#22cc88', eyes: 'normal' })
  })
  it('valida o que chega do disco ou da interface', () => {
    expect(isLook({ body: 'cloud', color: '#aabbcc', eyes: 'squint' })).toBe(true)
    expect(isLook({ color: 'red' })).toBe(false)
    expect(isLook({ body: 'dragão' })).toBe(false)
    expect(isLook({})).toBe(true)
  })
})
