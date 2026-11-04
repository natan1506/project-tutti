// @vitest-environment jsdom
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAgent } from '@shared/agents'
import { PADRAO, type Profile } from '@shared/profiles'
import { Composer } from '../../src/renderer/components/Composer'
import { ProfilePicker } from '../../src/renderer/components/ProfilePicker'
import { useProfileStore } from '../../src/renderer/state/profileStore'
import { useRunStore } from '../../src/renderer/state/runStore'
import { agentColor, shadeColor } from '../../src/renderer/stage/colors'
import { MascotBody } from '../../src/renderer/stage/mascots'
import { MascotLabel } from '../../src/renderer/stage/Mascot'
import { motionFrame } from '../../src/renderer/stage/motion'

afterEach(cleanup)

const DUO: Profile = {
  id: 'duo', nome: 'Duo', builtin: false, defaults: { transport: { kind: 'cli', tool: 'claude' } },
  agents: [
    { id: 'claudinho', nome: 'Claudinho', prompt: 'x', funcao: 'Geral', readOnly: false, reviewer: false, consultable: false },
    { id: 'kimi', nome: 'Kimi', prompt: 'x', funcao: 'Geral', readOnly: false, reviewer: false, consultable: false, transport: { kind: 'api', provider: 'openrouter' }, model: 'moonshotai/kimi-k3.1-pro' },
    { id: 'gepeto', nome: 'Gepeto', prompt: 'x', funcao: 'Geral', readOnly: false, reviewer: false, consultable: false, transport: { kind: 'api', provider: 'openai' }, model: 'gpt-6.1-terra' },
  ],
}
const api = {
  profiles: vi.fn(async () => [PADRAO, DUO]),
  activeProfile: vi.fn(async () => DUO),
  setActiveProfile: vi.fn(async () => {}),
  agentStatus: vi.fn(async () => ({ claudinho: { ok: true }, kimi: { ok: false, hint: 'Sem chave da OpenRouter' }, gepeto: { ok: true } })),
  removedAgents: vi.fn(async () => [{ ...getAgent('forja'), id: 'velho', nome: 'Velho (removido)', profileId: 'removido:x' }]),
  autonomy: vi.fn(async () => 'accept_edits'),
  setAutonomy: vi.fn(async () => {}),
}
beforeEach(async () => {
  Object.assign(window, { time: api })
  useRunStore.setState({ project: { id: 'p1', path: '/p', name: 'p', lastOpenedAt: 0 }, selectedAgent: 'time' })
  await act(() => useProfileStore.getState().load('p1'))
})

describe('perfil ativo na interface', () => {
  it('conversa antiga mostra o nome do agente de perfil apagado', () => {
    expect(getAgent('velho').nome).toBe('Velho (removido)')
  })

  it('cores: tom 0 é a cor base; Padrão mantém as cores de sempre', () => {
    expect(shadeColor('#d97757', 0)).toBe('#d97757')
    expect(shadeColor('#d97757', 1)).not.toBe('#d97757')
    expect(agentColor(getAgent('forja'))).toBe('#c9643f')
    expect(agentColor(getAgent('pincel'))).toBe('#e2b56f')
  })

  it('mascote pela família do modelo', async () => {
    const ref = { current: motionFrame('idle', 0, 0, 0) }
    const r = await ReactThreeTestRenderer.create(<MascotBody agentId="gepeto" frame={ref} t={{ current: 0 }} />)
    expect(r.scene.findAll(n => n.props.name === 'body-cloud')).toHaveLength(1)
    const k = await ReactThreeTestRenderer.create(<MascotBody agentId="kimi" frame={ref} t={{ current: 0 }} />)
    expect(k.scene.findAll(n => n.props.name === 'body-block')).toHaveLength(1)
  })

  it('compositor: chips do perfil, sem Time quando não há coordenador, agente sem chave travado com a dica', () => {
    const { container } = render(<Composer />)
    const chips = [...container.querySelectorAll('.chip')]
    expect(chips.map(c => c.textContent)).toEqual(['Claudinho', 'Kimi', 'Gepeto'])
    const kimi = chips[1] as HTMLButtonElement
    expect(kimi.disabled).toBe(true)
    expect(kimi.title).toBe('Sem chave da OpenRouter')
    expect(useRunStore.getState().selectedAgent).toBe('claudinho')
  })

  it('rótulo do agente por API mostra o provedor, não o motor', () => {
    const { container } = render(<MascotLabel id="kimi" view={{ pose: 'idle', label: 'Disponível' }} onSelect={() => {}} />)
    expect(container.querySelector('.tool')?.textContent).toBe('OpenRouter · API')
  })

  it('R6: reconsultar as ferramentas atualiza também a disponibilidade dos agentes', async () => {
    Object.assign(api, { toolStatus: vi.fn(async () => ({})) })
    api.agentStatus.mockResolvedValueOnce({ claudinho: { ok: true }, kimi: { ok: true }, gepeto: { ok: true } } as never)
    await act(() => useRunStore.getState().loadTools())
    expect(useProfileStore.getState().status.kimi).toEqual({ ok: true })
  })

  it('trocar de perfil grava no projeto', async () => {
    const { getByText } = render(<ProfilePicker />)
    fireEvent.click(getByText(/Duo/))
    await act(async () => { fireEvent.click(getByText('Padrão')) })
    expect(api.setActiveProfile).toHaveBeenCalledWith('p1', 'padrao')
  })
})
