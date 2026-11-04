// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SideResizer } from '../../src/renderer/components/SideResizer'
import { clampSideWidth, loadSideWidth, saveSideWidth, SIDE_DEFAULT, SIDE_MIN } from '../../src/renderer/state/sideWidth'

afterEach(cleanup)
beforeEach(() => { localStorage.clear(); document.documentElement.style.removeProperty('--side-w') })

describe('largura do painel do chat', () => {
  it('limita entre o mínimo e 60% da janela', () => {
    expect(clampSideWidth(100, 1440)).toBe(SIDE_MIN)
    expect(clampSideWidth(500, 1440)).toBe(500)
    expect(clampSideWidth(2000, 1440)).toBe(864)
  })

  it('lembra a largura escolhida; sem nada salvo, usa o padrão', () => {
    expect(loadSideWidth(1440)).toBe(SIDE_DEFAULT)
    saveSideWidth(520)
    expect(loadSideWidth(1440)).toBe(520)
  })

  it('arrastar a borda para a esquerda alarga o painel e grava', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
    const r = render(<SideResizer />)
    const handle = r.getByRole('separator', { name: 'Largura do chat' })
    fireEvent.mouseDown(handle, { clientX: 1060 })
    fireEvent.mouseMove(window, { clientX: 960 })
    fireEvent.mouseUp(window)
    expect(document.documentElement.style.getPropertyValue('--side-w')).toBe(`${SIDE_DEFAULT + 100}px`)
    expect(loadSideWidth(1440)).toBe(SIDE_DEFAULT + 100)
  })

  it('duplo clique volta ao padrão', () => {
    saveSideWidth(600)
    const r = render(<SideResizer />)
    fireEvent.doubleClick(r.getByRole('separator', { name: 'Largura do chat' }))
    expect(loadSideWidth(1440)).toBe(SIDE_DEFAULT)
  })
})
