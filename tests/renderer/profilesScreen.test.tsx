// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PADRAO, type Profile } from '@shared/profiles'
import { KeysSection } from '../../src/renderer/components/KeysSection'
import { ProfilesScreen } from '../../src/renderer/components/ProfilesScreen'
import { useProfileStore } from '../../src/renderer/state/profileStore'
import { useRunStore } from '../../src/renderer/state/runStore'

afterEach(cleanup)

const api = {
  saveProfile: vi.fn(async (p: Profile) => ({ ok: true as const, profile: { ...p, id: 'p_novo' } })),
  duplicateProfile: vi.fn(async () => ({ ...PADRAO, id: 'p_copia', nome: 'Padrão (cópia)', builtin: false })),
  deleteProfile: vi.fn(async () => {}),
  providerKeys: vi.fn(async () => ({ openrouter: true, moonshotai: false, openai: false, anthropic: false, google: false, deepseek: false })),
  setProviderKey: vi.fn(async () => {}),
  removeProviderKey: vi.fn(async () => {}),
  providerModels: vi.fn(async () => [{ id: 'moonshotai/kimi-k3.1-pro', name: 'Kimi K3.1 Pro' }]),
  profiles: vi.fn(async () => [PADRAO]),
  activeProfile: vi.fn(async () => PADRAO),
  agentStatus: vi.fn(async () => ({})),
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, { time: api })
  useRunStore.setState({ project: { id: 'p1', path: '/p', name: 'p', lastOpenedAt: 0 } })
  useProfileStore.setState({ profiles: [PADRAO], active: PADRAO, configOpen: true })
})

describe('tela de perfis', () => {
  it('Padrão é só leitura e pode ser duplicado', async () => {
    const r = render(<ProfilesScreen />)
    expect(r.getByText('Padrão · só leitura')).toBeTruthy()
    expect((r.getByLabelText('Nome do perfil') as HTMLInputElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(r.getByText('Duplicar')) })
    expect(api.duplicateProfile).toHaveBeenCalledWith('padrao', undefined)
  })

  it('perfil novo: até 8 agentes, "pode ser consultado" só para quem só lê', async () => {
    const r = render(<ProfilesScreen />)
    fireEvent.click(r.getByText('Novo perfil'))
    for (let i = 0; i < 7; i++) fireEvent.click(r.getByText('Adicionar agente'))
    expect(r.container.querySelectorAll('.agent-form')).toHaveLength(8)
    expect(r.queryByText('Adicionar agente')).toBeNull()
    const first = within(r.container.querySelectorAll('.agent-form')[0] as HTMLElement)
    expect((first.getByLabelText('Pode ser consultado') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(first.getByLabelText('Só lê'))
    expect((first.getByLabelText('Pode ser consultado') as HTMLInputElement).disabled).toBe(false)
  })

  it('salvar com nome repetido mostra o erro e não chama o app', async () => {
    const r = render(<ProfilesScreen />)
    fireEvent.click(r.getByText('Novo perfil'))
    fireEvent.change(r.getByLabelText('Nome do perfil'), { target: { value: 'Duo' } })
    fireEvent.click(r.getByText('Adicionar agente'))
    const forms = r.container.querySelectorAll('.agent-form')
    for (const f of forms) fireEvent.change(within(f as HTMLElement).getByLabelText('Nome'), { target: { value: 'Igual' } })
    await act(async () => { fireEvent.click(r.getByText('Salvar perfil')) })
    expect(r.getByText('Já existe um agente chamado "Igual".')).toBeTruthy()
    expect(api.saveProfile).not.toHaveBeenCalled()
  })

  it('agente por API avisa que é cobrado', () => {
    const r = render(<ProfilesScreen />)
    fireEvent.click(r.getByText('Novo perfil'))
    const f = within(r.container.querySelector('.agent-form') as HTMLElement)
    fireEvent.change(f.getByLabelText('Transporte'), { target: { value: 'api' } })
    expect(f.getByText('Usa a sua chave: cada pedido é cobrado pelo provedor.')).toBeTruthy()
  })
})

describe('chaves', () => {
  it('chave salva aparece como salva, sem campo com o valor', async () => {
    const r = render(<KeysSection />)
    await act(async () => {})
    const row = within(r.getByText('OpenRouter').closest('.key-row') as HTMLElement)
    expect(row.getByText('Chave salva')).toBeTruthy()
    expect(row.queryByLabelText('Chave da OpenRouter')).toBeNull()
    expect(r.getByLabelText('Chave da OpenAI')).toBeTruthy()
  })
  it('salvar chave chama o app e limpa o campo', async () => {
    const r = render(<KeysSection />)
    await act(async () => {})
    const input = r.getByLabelText('Chave da OpenAI') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'sk-teste' } })
    await act(async () => { fireEvent.click(within(input.closest('.key-row') as HTMLElement).getByText('Salvar')) })
    expect(api.setProviderKey).toHaveBeenCalledWith('openai', 'sk-teste')
  })
})
