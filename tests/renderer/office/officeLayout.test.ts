import { describe, expect, it } from 'vitest'
import { coffeeSpot, deskSpot, meetingSeat, pathBetween, CORRIDOR_Z } from '../../../src/renderer/stage/office/layout'
import { officeTargets } from '../../../src/renderer/stage/office/targets'
import type { MascotView } from '../../../src/renderer/stage/derive'

describe('sala do escritório', () => {
  it('mesas em duas fileiras, sem repetir lugar, até 8', () => {
    const spots = Array.from({ length: 8 }, (_, i) => deskSpot(i, 8))
    expect(new Set(spots.map(s => `${s.x},${s.z}`)).size).toBe(8)
    expect(new Set(spots.map(s => s.z)).size).toBe(2)
  })
  it('lugares da reunião ficam em volta da mesa redonda', () => {
    const a = meetingSeat(0, 4), b = meetingSeat(2, 4)
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1)
  })
  it('caminho passa pelo corredor e termina no destino', () => {
    const from = deskSpot(0, 6), to = coffeeSpot()
    const p = pathBetween(from, to)
    expect(p[0]).toEqual(from)
    expect(p.at(-1)).toEqual(to)
    expect(p.some(q => q.z === CORRIDOR_Z)).toBe(true)
  })
})

describe('para onde cada mascote vai', () => {
  const idle: MascotView = { pose: 'idle', label: 'Disponível' }
  const views = { a: idle, b: idle, c: { pose: 'locked', label: 'x' } as MascotView }
  it('sem time: todo mundo na mesa', () => {
    expect(officeTargets(['a', 'b', 'c'], views, undefined)).toEqual({ a: 'desk', b: 'desk', c: 'desk' })
  })
  it('triagem/confirmação/plano: participantes na reunião; travado fica', () => {
    expect(officeTargets(['a', 'b', 'c'], views, { phase: 'meeting', participants: ['a', 'c'] })).toEqual({ a: 'meeting', b: 'desk', c: 'desk' })
  })
  it('café: só um agente livre por vez', () => {
    expect(officeTargets(['a', 'b'], views, undefined, 'b')).toEqual({ a: 'desk', b: 'coffee' })
    expect(officeTargets(['a', 'b'], { ...views, b: { pose: 'working', label: 'x' } }, undefined, 'b')).toEqual({ a: 'desk', b: 'desk' })
  })
})
