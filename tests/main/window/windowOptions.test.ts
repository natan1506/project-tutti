import { describe, expect, it } from 'vitest'
import { TRAFFIC_LIGHTS, windowOptions } from '../../../src/main/windowOptions'

describe('janela', () => {
  it('sem a barra de título cinza: botões do macOS sobre o fundo do app', () => {
    const o = windowOptions('/preload.cjs')
    expect(o.titleBarStyle).toBe('hiddenInset')
    expect(o.trafficLightPosition).toEqual(TRAFFIC_LIGHTS)
    expect(o.backgroundColor).toBe('#0c0b1f')
    expect(o.webPreferences).toMatchObject({ preload: '/preload.cjs', contextIsolation: true, nodeIntegration: false, sandbox: true })
  })
})
