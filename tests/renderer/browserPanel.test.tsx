// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserPanel } from '../../src/renderer/components/BrowserPanel'
import { applyBrowserState, useBrowserStore } from '../../src/renderer/state/browserStore'
import { useViewStore } from '../../src/renderer/state/viewStore'
import { EMPTY_BROWSER } from '@shared/browser'

const api = {
  browserBounds: vi.fn(async () => {}), browserSelect: vi.fn(async () => {}), browserTakeover: vi.fn(async () => {}),
  browserRelease: vi.fn(async () => {}), browserNavigate: vi.fn(async () => {}), browserBack: vi.fn(async () => {}),
  browserReload: vi.fn(async () => {}), browserClose: vi.fn(async () => {}),
}
class RO { observe() {} disconnect() {} }
beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { time: unknown }).time = api
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO
  useBrowserStore.setState(EMPTY_BROWSER)
  useViewStore.setState({ view: 'palco' })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 300, height: 200 } as DOMRect)
})
afterEach(() => { cleanup(); document.body.innerHTML = '' })

const tab = (agentId: string, url = 'https://site.dev/a') => ({ agentId, url, title: 'Site', loading: false })

describe('painel do navegador', () => {
  it('sem abas, explica e não reserva área nenhuma', () => {
    const r = render(<BrowserPanel />)
    expect(r.getByText(/Nenhum agente abriu/)).toBeTruthy()
    expect(api.browserBounds).toHaveBeenLastCalledWith(null)
  })
  it('mostra a aba com o nome do agente e o endereço; Assumir chama o app', () => {
    useBrowserStore.setState({ tabs: [tab('forja')] as never, active: 'forja', control: null })
    const r = render(<BrowserPanel />)
    expect(r.getByRole('button', { name: /Forja/ })).toBeTruthy()
    expect((r.getByLabelText('Endereço') as HTMLInputElement).value).toBe('https://site.dev/a')
    expect((r.getByLabelText('Endereço') as HTMLInputElement).readOnly).toBe(true)
    fireEvent.click(r.getByRole('button', { name: 'Assumir' }))
    expect(api.browserTakeover).toHaveBeenCalledWith('forja')
  })
  it('no controle: Devolver, endereço editável e navegação', () => {
    useBrowserStore.setState({ tabs: [tab('forja')] as never, active: 'forja', control: 'forja' })
    const r = render(<BrowserPanel />)
    const input = r.getByLabelText('Endereço') as HTMLInputElement
    expect(input.readOnly).toBe(false)
    fireEvent.change(input, { target: { value: 'login.dev' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(api.browserNavigate).toHaveBeenCalledWith('https://login.dev')
    fireEvent.click(r.getByRole('button', { name: 'Devolver' }))
    expect(api.browserRelease).toHaveBeenCalled()
  })
  it('esconde a página nativa enquanto um menu ou modal está aberto, porque ela ficaria por cima', async () => {
    useBrowserStore.setState({ tabs: [tab('forja')] as never, active: 'forja', control: null })
    render(<BrowserPanel />)
    await waitFor(() => expect(api.browserBounds).toHaveBeenLastCalledWith(expect.anything()))
    const menu = document.createElement('div')
    menu.className = 'menu'
    document.body.appendChild(menu)
    await waitFor(() => expect(api.browserBounds).toHaveBeenLastCalledWith(null))
    menu.remove()
    await waitFor(() => expect(api.browserBounds).toHaveBeenLastCalledWith(expect.anything()))
  })
  it('ao sair da vista, esconde a página', () => {
    useBrowserStore.setState({ tabs: [tab('forja')] as never, active: 'forja', control: null })
    const r = render(<BrowserPanel />)
    r.unmount()
    expect(api.browserBounds).toHaveBeenLastCalledWith(null)
  })
})

describe('estado vindo do app', () => {
  it('agente abriu aba: mostra o navegador; atualização comum não muda a vista', () => {
    applyBrowserState({ tabs: [tab('forja')] as never, active: 'forja', control: null })
    expect(useViewStore.getState().view).toBe('palco')
    applyBrowserState({ tabs: [tab('forja')] as never, active: 'forja', control: null, opened: 'forja' })
    expect(useViewStore.getState().view).toBe('navegador')
    expect(useBrowserStore.getState().tabs).toHaveLength(1)
  })
  it('a vista Navegador não fica salva: reabrir o app volta ao Palco ou Escritório', () => {
    localStorage.setItem('tutti:stage-view', 'escritorio')
    useViewStore.getState().setView('navegador')
    expect(localStorage.getItem('tutti:stage-view')).toBe('escritorio')
  })
  it('sem abas, sair do Navegador volta para a vista anterior', () => {
    useViewStore.setState({ view: 'escritorio' })
    useViewStore.getState().setView('navegador')
    applyBrowserState({ tabs: [tab('forja')] as never, active: 'forja', control: null })
    applyBrowserState(EMPTY_BROWSER)
    expect(useViewStore.getState().view).toBe('escritorio')
  })
})
