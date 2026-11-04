// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PADRAO } from '@shared/profiles'
import { MascotsScreen } from '../../src/renderer/components/MascotsScreen'
import { useLookStore } from '../../src/renderer/state/lookStore'
import { useProfileStore } from '../../src/renderer/state/profileStore'

afterEach(cleanup)
const api = { setLook: vi.fn(async ({ agentId, look }: { agentId: string; look: unknown }) => (look ? { [agentId]: look } : {})), looks: vi.fn(async () => ({})) }
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, { time: api })
  useProfileStore.setState({ profiles: [PADRAO], active: PADRAO })
  useLookStore.setState({ looks: {}, open: true })
})

describe('tela de mascotes', () => {
  it('escolhe o agente e muda cor, corpo e olhos', async () => {
    const r = render(<MascotsScreen preview={false} />)
    fireEvent.click(r.getByRole('button', { name: /Forja/ }))
    await act(async () => { fireEvent.click(r.getByRole('button', { name: 'Cor #3ecf8e' })) })
    expect(api.setLook).toHaveBeenLastCalledWith({ agentId: 'forja', look: { color: '#3ecf8e' } })
    await act(async () => { fireEvent.change(r.getByLabelText('Corpo'), { target: { value: 'cloud' } }) })
    expect(api.setLook).toHaveBeenLastCalledWith({ agentId: 'forja', look: { color: '#3ecf8e', body: 'cloud' } })
    expect((r.getByLabelText('Cor personalizada') as HTMLInputElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(r.getByRole('button', { name: 'Feliz' })) })
    expect(api.setLook).toHaveBeenLastCalledWith({ agentId: 'forja', look: { color: '#3ecf8e', body: 'cloud', eyes: 'happy' } })
  })

  it('restaurar volta ao padrão da ferramenta', async () => {
    useLookStore.setState({ looks: { bussola: { color: '#3ecf8e' } } })
    const r = render(<MascotsScreen preview={false} />)
    await act(async () => { fireEvent.click(r.getByText('Restaurar padrão')) })
    expect(api.setLook).toHaveBeenLastCalledWith({ agentId: 'bussola', look: null })
  })
})
