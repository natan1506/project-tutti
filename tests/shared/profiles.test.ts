import { describe, expect, it } from 'vitest'
import { getAgent, knownAgent, registerAgents } from '@shared/agents'
import { PADRAO, familyOf, isPaidApi, resolveAgentDefs, validateProfile, type Profile, type ProfileAgent } from '@shared/profiles'

const agente: ProfileAgent = { id: 'a1', nome: 'Forja', prompt: 'Você faz back-end.', funcao: 'Back-end', readOnly: false, reviewer: false, consultable: false }
const base: Profile = { id: 'p1', nome: 'Meu', builtin: false, defaults: { transport: { kind: 'cli', tool: 'claude' } }, agents: [agente] }

describe('perfis', () => {
  it('Padrão: seis agentes com os papéis de hoje', () => {
    const d = resolveAgentDefs(PADRAO)
    expect(d.map(a => a.id)).toEqual(['bussola', 'forja', 'pincel', 'radar', 'lupa', 'curinga'])
    expect(d.find(a => a.id === 'bussola')!.coordinator).toBe(true)
    expect(d.filter(a => a.coordinator)).toHaveLength(1)
    expect(d.filter(a => a.reviewer).map(a => a.id)).toEqual(['lupa'])
    expect(d.filter(a => a.consultable).map(a => a.id)).toEqual(['radar', 'lupa'])
    expect(d.every(a => !isPaidApi(a))).toBe(true)
    expect(d.every(a => a.profileId === 'padrao')).toBe(true)
  })

  it('persona termina com a regra do idioma, sem repetir', () => {
    const [a] = resolveAgentDefs({ ...base, agents: [{ ...agente, prompt: 'Faz X. Responda sempre em português do Brasil.' }] })
    expect(a.persona).toBe('Faz X. Responda sempre em português do Brasil.')
    expect(resolveAgentDefs(base)[0].persona).toBe('Você faz back-end. Responda sempre em português do Brasil.')
  })

  it('família pelo modelo e tom por ordem na família', () => {
    expect(familyOf({ kind: 'api', provider: 'openrouter' }, 'anthropic/claude-sonnet-4.5')).toBe('claude')
    expect(familyOf({ kind: 'api', provider: 'openrouter' }, 'moonshotai/kimi-k3.1-pro')).toBe('other')
    expect(familyOf({ kind: 'api', provider: 'openai' }, 'gpt-6.1-terra')).toBe('gpt')
    expect(familyOf({ kind: 'api', provider: 'google' }, 'gemini-4-argon')).toBe('gemini')
    expect(familyOf({ kind: 'api', provider: 'anthropic' }, 'qualquer')).toBe('claude')
    expect(familyOf({ kind: 'cli', tool: 'gemini' })).toBe('gemini')
    expect(familyOf({ kind: 'cli', tool: 'codex' })).toBe('gpt')
    expect(familyOf({ kind: 'cli', tool: 'opencode' })).toBe('other')
    expect(resolveAgentDefs(PADRAO).filter(a => a.family === 'claude').map(a => a.shade)).toEqual([0, 1, 2])
  })

  it('agente herda transporte e modelo do perfil; API roda no opencode', () => {
    const p: Profile = { ...base, defaults: { transport: { kind: 'api', provider: 'openrouter' }, model: 'moonshotai/kimi-k3.1-pro' } }
    const [a] = resolveAgentDefs(p)
    expect(a).toMatchObject({ tool: 'opencode', transport: { kind: 'api', provider: 'openrouter' }, defaultModel: 'moonshotai/kimi-k3.1-pro', family: 'other' })
    expect(isPaidApi(a)).toBe(true)
    const [b] = resolveAgentDefs({ ...p, agents: [{ ...agente, transport: { kind: 'cli', tool: 'codex' }, model: 'gpt-6.1' }] })
    expect(b).toMatchObject({ tool: 'codex', defaultModel: 'gpt-6.1', family: 'gpt' })
  })

  it('coordenador marcado pelo perfil', () => {
    const d = resolveAgentDefs({ ...base, coordinatorId: 'a1' })
    expect(d[0].coordinator).toBe(true)
    expect(resolveAgentDefs(base)[0].coordinator).toBe(false)
  })

  it('validação', () => {
    expect(validateProfile(base).ok).toBe(true)
    expect(validateProfile({ ...base, agents: [] }).ok).toBe(false)
    expect(validateProfile({ ...base, agents: Array.from({ length: 9 }, (_, i) => ({ ...agente, id: `a${i}`, nome: `A${i}` })) }).ok).toBe(false)
    expect(validateProfile({ ...base, agents: [agente, { ...agente, id: 'b', nome: 'FORJA' }] }).ok).toBe(false)
    expect(validateProfile({ ...base, agents: [{ ...agente, nome: '  ' }] }).ok).toBe(false)
    expect(validateProfile({ ...base, agents: [{ ...agente, consultable: true, readOnly: false }] }).ok).toBe(false)
    expect(validateProfile({ ...base, agents: [{ ...agente, transport: { kind: 'api', provider: 'openai' } }] }).ok).toBe(false)
    expect(validateProfile({ ...base, coordinatorId: 'nao-existe' }).ok).toBe(false)
    expect(validateProfile({ ...base, agents: [{ ...agente, readOnly: true }], coordinatorId: 'a1' }).ok).toBe(false)
    expect(validateProfile({ ...base, defaults: { transport: { kind: 'api', provider: 'xpto' } } }).ok).toBe(false)
    expect(validateProfile('lixo').ok).toBe(false)
  })

  it('erro de validação vem em português', () => {
    const r = validateProfile({ ...base, agents: [agente, { ...agente, id: 'b', nome: 'forja' }] })
    expect(r.ok === false && r.errors).toContain('Já existe um agente chamado "forja".')
  })
})

describe('registro de agentes', () => {
  it('id desconhecido vira agente removido, sem lançar', () => {
    expect(getAgent('sumiu')).toMatchObject({ id: 'sumiu', nome: 'Agente (removido)', family: 'other' })
    expect(knownAgent('sumiu')).toBe(false)
    expect(knownAgent('forja')).toBe(true)
  })
  it('registrar um perfil substitui só os agentes dele', () => {
    registerAgents(resolveAgentDefs(base))
    expect(getAgent('a1').nome).toBe('Forja')
    registerAgents(resolveAgentDefs({ ...base, agents: [{ ...agente, id: 'a2', nome: 'Outro' }] }))
    expect(knownAgent('a1')).toBe(false)
    expect(getAgent('a2').nome).toBe('Outro')
    expect(getAgent('forja').profileId).toBe('padrao')
  })
})
