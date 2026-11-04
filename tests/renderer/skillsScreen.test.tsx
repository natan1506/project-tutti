// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PADRAO, type Profile } from '@shared/profiles'
import type { Skill } from '@shared/skills'
import { SkillsScreen } from '../../src/renderer/components/SkillsScreen'
import { useProfileStore } from '../../src/renderer/state/profileStore'
import { useRunStore } from '../../src/renderer/state/runStore'
import { useSkillStore } from '../../src/renderer/state/skillStore'

afterEach(cleanup)

const draft = { name: 'resumo-3', description: 'Use em resumos.', body: 'Três tópicos.' }
const outro: Profile = {
  id: 'p2', nome: 'Barato', builtin: false, defaults: { transport: { kind: 'cli', tool: 'claude' } },
  agents: [{ id: 'kimi', nome: 'Kimi', prompt: 'p', funcao: 'f', readOnly: false, reviewer: false, consultable: false, transport: { kind: 'api', provider: 'deepseek' }, model: 'deepseek-chat' }],
}
const api = {
  skills: vi.fn(async (): Promise<Skill[]> => []),
  saveSkill: vi.fn(async (s: Skill) => ({ ok: true as const, skill: { ...s, id: 'sk_1' } })),
  deleteSkill: vi.fn(async () => {}),
  createSkill: vi.fn(async () => ({ ok: true as const, skill: draft })),
  testSkill: vi.fn(async () => ({ ok: true as const, answer: '- a\n- b\n- c' })),
  improveSkill: vi.fn(async () => ({ ok: true as const, skill: { ...draft, body: 'Três tópicos curtos.' } })),
  cancelSkill: vi.fn(async () => {}),
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, { time: api })
  useRunStore.setState({ project: { id: 'p1', path: '/proj', name: 'proj', lastOpenedAt: 0 } })
  useProfileStore.setState({ profiles: [PADRAO, outro], active: PADRAO })
  useSkillStore.setState({ skills: [], open: true })
})

const create = async (r: ReturnType<typeof render>) => {
  await act(async () => {})
  fireEvent.click(r.getByText('Nova skill'))
  fireEvent.change(r.getByLabelText('O que a skill deve fazer'), { target: { value: 'resumo em três tópicos' } })
  await act(async () => { fireEvent.click(r.getByText('Criar')) })
}

describe('tela de skills', () => {
  it('cria com quem o Natan escolheu e mostra a skill para editar', async () => {
    const r = render(<SkillsScreen />)
    fireEvent.click(r.getByText('Nova skill'))
    fireEvent.change(r.getByLabelText('Quem cria'), { target: { value: 'pincel' } })
    fireEvent.change(r.getByLabelText('O que a skill deve fazer'), { target: { value: 'resumo em três tópicos' } })
    await act(async () => { fireEvent.click(r.getByText('Criar')) })
    expect(api.createSkill).toHaveBeenCalledWith(expect.objectContaining({ request: 'resumo em três tópicos', creatorId: 'pincel', confirmPaid: false }))
    expect((r.getByLabelText('Nome') as HTMLInputElement).value).toBe('resumo-3')
    expect((r.getByLabelText('Instruções') as HTMLTextAreaElement).value).toBe('Três tópicos.')
  })

  it('agente pago: o botão avisa e manda a confirmação', async () => {
    useProfileStore.setState({ active: outro })
    const r = render(<SkillsScreen />)
    fireEvent.click(r.getByText('Nova skill'))
    fireEvent.change(r.getByLabelText('O que a skill deve fazer'), { target: { value: 'x' } })
    await act(async () => { fireEvent.click(r.getByText('Criar (API paga — DeepSeek)')) })
    expect(api.createSkill).toHaveBeenCalledWith(expect.objectContaining({ creatorId: 'kimi', confirmPaid: true }))
  })

  it('I-2: com execução em andamento, não dá para trocar de skill', async () => {
    useSkillStore.setState({ skills: [{ id: 'sk_b', ...draft, name: 'outra', agentIds: [], updatedAt: 0 }] })
    api.skills.mockResolvedValue([{ id: 'sk_b', ...draft, name: 'outra', agentIds: [], updatedAt: 0 }])
    let finish!: (v: unknown) => void
    api.createSkill.mockReturnValueOnce(new Promise(res => { finish = res }) as never)
    const r = render(<SkillsScreen />)
    await act(async () => {})
    fireEvent.click(r.getByText('Nova skill'))
    fireEvent.change(r.getByLabelText('O que a skill deve fazer'), { target: { value: 'x' } })
    fireEvent.click(r.getByText('Criar'))
    expect((r.getByText('outra') as HTMLButtonElement).disabled).toBe(true)
    expect((r.getByText('Nova skill') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { finish({ ok: true, skill: draft }) })
  })

  it('I-5: Ajustar com quem cria pago mostra o aviso no botão', async () => {
    useProfileStore.setState({ active: outro })
    const r = render(<SkillsScreen />)
    fireEvent.click(r.getByText('Nova skill'))
    fireEvent.change(r.getByLabelText('O que a skill deve fazer'), { target: { value: 'x' } })
    await act(async () => { fireEvent.click(r.getByText('Criar (API paga — DeepSeek)')) })
    expect(r.getByText('Ajustar (API paga — DeepSeek)')).toBeTruthy()
  })

  it('I-6: erro na chamada (ex.: limite de tamanho) aparece e o tempo esgotado também', async () => {
    const r = render(<SkillsScreen />)
    await create(r)
    api.testSkill.mockRejectedValueOnce(new Error('zod'))
    fireEvent.change(r.getByLabelText('Tarefa de exemplo'), { target: { value: 't' } })
    await act(async () => { fireEvent.click(r.getByText('Testar')) })
    expect(r.getByText('Algo deu errado. Tente de novo.')).toBeTruthy()
    api.testSkill.mockResolvedValueOnce({ ok: false, error: 'TIMEOUT' } as never)
    await act(async () => { fireEvent.click(r.getByText('Testar')) })
    expect(r.getByText('O agente não respondeu a tempo.')).toBeTruthy()
    api.testSkill.mockResolvedValueOnce({ ok: false, error: 'EMPTY_ANSWER' } as never)
    await act(async () => { fireEvent.click(r.getByText('Testar')) })
    expect(r.getByText('O agente não respondeu nada. Tente de novo ou escolha outro agente.')).toBeTruthy()
    api.testSkill.mockResolvedValueOnce({ ok: false, error: 'AGENT_ERROR' } as never)
    await act(async () => { fireEvent.click(r.getByText('Testar')) })
    expect(r.getByText('O agente deu erro. Tente de novo ou escolha outro agente.')).toBeTruthy()
    expect((r.getByLabelText('Instruções') as HTMLTextAreaElement).maxLength).toBe(20000)
  })

  it('testa no projeto aberto e ajusta com o resultado', async () => {
    const r = render(<SkillsScreen />)
    await create(r)
    expect((r.getByText('Ajustar') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(r.getByLabelText('Tarefa de exemplo'), { target: { value: 'resuma o README' } })
    await act(async () => { fireEvent.click(r.getByText('Testar')) })
    expect(api.testSkill).toHaveBeenCalledWith(expect.objectContaining({ skill: draft, task: 'resuma o README', projectPath: '/proj' }))
    expect(r.getByText(/- a/)).toBeTruthy()
    await act(async () => { fireEvent.click(r.getByText('Ajustar')) })
    expect(api.improveSkill).toHaveBeenCalledWith(expect.objectContaining({ skill: draft, task: 'resuma o README', answer: '- a\n- b\n- c' }))
    expect((r.getByLabelText('Instruções') as HTMLTextAreaElement).value).toBe('Três tópicos curtos.')
  })

  it('resposta sem skill válida: aviso e o rascunho continua', async () => {
    const r = render(<SkillsScreen />)
    await create(r)
    api.improveSkill.mockResolvedValueOnce({ ok: false, error: 'INVALID_SKILL' } as never)
    fireEvent.change(r.getByLabelText('Tarefa de exemplo'), { target: { value: 't' } })
    await act(async () => { fireEvent.click(r.getByText('Testar')) })
    await act(async () => { fireEvent.click(r.getByText('Ajustar')) })
    expect(r.getByText('O agente não devolveu uma skill válida.')).toBeTruthy()
    expect((r.getByLabelText('Instruções') as HTMLTextAreaElement).value).toBe('Três tópicos.')
  })

  it('marca agentes de qualquer perfil e salva; erro aparece', async () => {
    const r = render(<SkillsScreen />)
    await create(r)
    fireEvent.click(r.getByLabelText('Forja'))
    fireEvent.click(r.getByLabelText('Kimi'))
    await act(async () => { fireEvent.click(r.getByText('Salvar skill')) })
    expect(api.saveSkill).toHaveBeenCalledWith(expect.objectContaining({ ...draft, agentIds: ['forja', 'kimi'] }))
    api.saveSkill.mockResolvedValueOnce({ ok: false, errors: ['Já existe uma skill chamada "resumo-3".'] } as never)
    await act(async () => { fireEvent.click(r.getByText('Salvar skill')) })
    expect(r.getByText('Já existe uma skill chamada "resumo-3".')).toBeTruthy()
  })

  it('fechar no meio de uma execução cancela', async () => {
    let finish!: (v: unknown) => void
    api.createSkill.mockReturnValueOnce(new Promise(res => { finish = res }) as never)
    const r = render(<SkillsScreen />)
    fireEvent.click(r.getByText('Nova skill'))
    fireEvent.change(r.getByLabelText('O que a skill deve fazer'), { target: { value: 'x' } })
    fireEvent.click(r.getByText('Criar'))
    expect(r.getByText('Criando…')).toBeTruthy()
    fireEvent.click(r.getByText('Fechar'))
    expect(api.cancelSkill).toHaveBeenCalled()
    expect(useSkillStore.getState().open).toBe(false)
    await act(async () => { finish({ ok: false, error: 'CANCELED' }) })
  })
})

describe('menu do perfil', () => {
  it('o botão Skills da barra abre a janela de skills', async () => {
    const { Rail } = await import('../../src/renderer/components/Rail')
    useSkillStore.setState({ open: false })
    const r = render(<Rail />)
    fireEvent.click(r.getByRole('button', { name: 'Skills' }))
    expect(useSkillStore.getState().open).toBe(true)
  })
})
