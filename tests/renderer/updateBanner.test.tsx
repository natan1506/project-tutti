// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateBanner } from '../../src/renderer/components/UpdateBanner'

afterEach(cleanup)

describe('UpdateBanner', () => {
  it('sem versão nova não mostra nada', async () => {
    Object.assign(window, { time: { updateInfo: vi.fn(async () => null), onUpdate: vi.fn(() => () => {}), openUpdate: vi.fn() } })
    const r = render(<UpdateBanner />)
    await act(async () => {})
    expect(r.container.textContent).toBe('')
  })
  it('versão nova: aviso e botão que abre a página da release', async () => {
    const openUpdate = vi.fn(async () => {})
    Object.assign(window, { time: { updateInfo: vi.fn(async () => ({ version: '0.2.0', url: 'https://github.com/x' })), onUpdate: vi.fn(() => () => {}), openUpdate } })
    const r = render(<UpdateBanner />)
    await act(async () => {})
    expect(r.getByText('Versão 0.2.0 disponível')).toBeTruthy()
    fireEvent.click(r.getByText('Baixar'))
    expect(openUpdate).toHaveBeenCalled()
  })
})
