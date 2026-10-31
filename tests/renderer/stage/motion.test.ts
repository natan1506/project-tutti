import { describe, expect, it } from 'vitest'
import { DONE_JUMP_S, motionFrame, screenText } from '../../../src/renderer/stage/motion'
import type { Pose } from '../../../src/renderer/stage/derive'

const POSES: Pose[] = ['idle', 'thinking', 'working', 'waiting', 'done', 'locked']

describe('motionFrame', () => {
  it('trabalhando: olhos > <, pulinhos e achatamento', () => {
    for (const t of [0, 0.13, 0.4, 1.7]) {
      const f = motionFrame('working', t, 0, 1)
      expect(f.expression).toBe('squint')
      expect(f.y).toBeGreaterThanOrEqual(0)
      expect(f.y).toBeLessThanOrEqual(0.07)
      expect(f.squash).toBeLessThanOrEqual(1)
    }
  })

  it('concluído pula no começo e depois sossega, ainda feliz', () => {
    const early = motionFrame('done', 5, 0, 0.2)
    expect(early.y).toBeGreaterThan(0)
    expect(early.expression).toBe('happy')
    const late = motionFrame('done', 5, 0, DONE_JUMP_S + 0.7)
    expect(Math.abs(late.y)).toBeLessThanOrEqual(0.022)
    expect(late.expression).toBe('happy')
  })

  it('parado pisca a cada 4.2 s', () => {
    expect(motionFrame('idle', 0.05, 0, 0).blink).toBe(true)
    expect(motionFrame('idle', 1, 0, 0).blink).toBe(false)
    expect(motionFrame('idle', 4.25, 0, 0).blink).toBe(true)
  })

  it('pensando olha para cima', () => {
    expect(motionFrame('thinking', 1, 0, 0).eyeDY).toBeCloseTo(0.06)
  })

  it('esperando olha para a câmera, parado', () => {
    const f = motionFrame('waiting', 2.3, 1, 0)
    expect(f.rotY).toBe(0)
    expect(f.y).toBe(0)
  })

  it('expressão padrão (Forja) vale em parado e pensando, mas concluído fica feliz', () => {
    const o = { defaultExpression: 'squint' as const }
    expect(motionFrame('idle', 1, 0, 0, o).expression).toBe('squint')
    expect(motionFrame('thinking', 1, 0, 0, o).expression).toBe('squint')
    expect(motionFrame('done', 1, 0, 0, o).expression).toBe('happy')
  })

  it('flutuante balança mais quando parado', () => {
    const amps = Array.from({ length: 50 }, (_, i) => Math.abs(motionFrame('idle', i * 0.1, 0, 0, { float: true }).y))
    expect(Math.max(...amps)).toBeGreaterThan(0.022)
    expect(Math.max(...amps)).toBeLessThanOrEqual(0.07)
  })

  it('travado mexe menos e não pisca', () => {
    const f = motionFrame('locked', 0.05, 0, 0)
    expect(f.blink).toBe(false)
    expect(Math.abs(f.rotY)).toBeLessThanOrEqual(0.14 * 0.4 + 1e-9)
  })

  it('movimento reduzido zera deslocamentos mas mantém a expressão', () => {
    for (const pose of POSES) {
      const f = motionFrame(pose, 1.234, 0.5, 0.3, { reduced: true })
      expect([f.y, f.rotZ, f.rotY]).toEqual([0, 0, 0])
      expect(f.expression).toBe(motionFrame(pose, 1.234, 0.5, 0.3).expression)
    }
  })

  it('acessório gira mais rápido quando pensa ou trabalha', () => {
    expect(motionFrame('thinking', 0, 0, 0).spin).toBe(0.08)
    expect(motionFrame('working', 0, 0, 0).spin).toBe(0.15)
    expect(motionFrame('idle', 0, 0, 0).spin).toBe(0.01)
  })
})

describe('screenText', () => {
  it('parado: cursor piscando a 1.6 Hz', () => {
    expect(screenText('idle', 0.1, false)).toBe('> ')
    expect(screenText('idle', 0.7, false)).toBe('>_')
  })
  it('piscando: - -', () => expect(screenText('idle', 0.7, true)).toBe('- -'))
  it('pensando: pontinhos a 3 Hz', () => {
    expect([0.1, 0.4, 0.7].map(t => screenText('thinking', t, false))).toEqual(['.  ', '.. ', '...'])
  })
  it('trabalhando: cursor rápido a 6 Hz', () => {
    expect(screenText('working', 0.05, false)).toBe('> ')
    expect(screenText('working', 0.2, false)).toBe('>_')
  })
  it('concluído e esperando', () => {
    expect(screenText('done', 3, false)).toBe('^ ^')
    expect(screenText('waiting', 3, false)).toBe('!')
  })
})
