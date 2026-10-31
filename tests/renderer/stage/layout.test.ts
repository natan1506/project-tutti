import { describe, expect, it } from 'vitest'
import { fitCameraDistance, mascotX, SPACING } from '../../../src/renderer/stage/layout'

describe('mascotX', () => {
  it('centraliza a fileira em zero', () => {
    expect(mascotX(0, 6)).toBeCloseTo(-5.875)
    expect(mascotX(5, 6)).toBeCloseTo(5.875)
    expect(mascotX(0, 1)).toBe(0)
  })
})

describe('fitCameraDistance', () => {
  it.each([0.9, 1.2, 1.8])('com aspecto %s os seis mascotes cabem na largura', aspect => {
    const d = fitCameraDistance(6, SPACING, 28, aspect)
    const visible = 2 * d * Math.tan((14 * Math.PI) / 180) * aspect
    expect(visible).toBeGreaterThanOrEqual(6 * SPACING + 1.2 - 1e-9)
  })
  it('nunca chega mais perto que o mínimo', () => {
    expect(fitCameraDistance(1, SPACING, 28, 3)).toBe(10)
  })
})
