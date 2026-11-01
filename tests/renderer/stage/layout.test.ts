import { describe, expect, it } from 'vitest'
import { bubbleMaxWidth, fitCameraDistance, mascotX, SPACING } from '../../../src/renderer/stage/layout'

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
  it('perfil com poucos agentes fica do mesmo tamanho do Padrão (enquadra pelo menos seis lugares)', () => {
    expect(fitCameraDistance(3, SPACING, 28, 0.9)).toBe(fitCameraDistance(6, SPACING, 28, 0.9))
    expect(fitCameraDistance(8, SPACING, 28, 0.9)).toBeGreaterThan(fitCameraDistance(6, SPACING, 28, 0.9))
  })
  it('nunca chega mais perto que o mínimo', () => {
    expect(fitCameraDistance(1, SPACING, 28, 5)).toBe(10)
  })
})

describe('bubbleMaxWidth', () => {
  it.each([748, 848, 1400])('balão nunca passa do espaço entre dois mascotes (palco %ipx)', stage => {
    const spacingPx = (stage * SPACING) / (6 * SPACING + 1.2)
    const w = bubbleMaxWidth(stage, 6)
    expect(w).toBeLessThanOrEqual(spacingPx)
    expect(w).toBeGreaterThanOrEqual(Math.min(90, spacingPx))
  })
  it('tem teto de 200px em palcos grandes', () => {
    expect(bubbleMaxWidth(4000, 6)).toBe(200)
  })
})
