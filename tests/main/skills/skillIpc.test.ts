import { describe, expect, it } from 'vitest'
import { toSkillMd } from '@shared/skills'
import { openStore } from '../../../src/main/store/db'
import { SkillService, type ConsultInput } from '../../../src/main/skills/skillService'
import { skillHandlers } from '../../../src/main/skills/skillIpc'

const draft = { name: 'resumo-3', description: 'Use em resumos.', body: 'Três tópicos.' }

function setup(consult: (i: ConsultInput) => Promise<string>) {
  const calls: ConsultInput[] = []
  const svc = new SkillService({
    store: openStore(':memory:'), workDir: '/w', isPaid: id => id === 'curinga',
    runs: { consultOnce: i => { calls.push(i); return consult(i) } },
  })
  return { h: skillHandlers(svc), calls, svc }
}

describe('IPC das skills', () => {
  it('entrada inválida é recusada', async () => {
    const { h } = setup(async () => '')
    await expect(h.createSkill({ draftId: 'd', request: 42, creatorId: 'forja' })).rejects.toThrow()
    await expect(h.createSkill({ draftId: 'd', request: 'x', creatorId: 'nao-existe' })).rejects.toThrow()
    await expect(h.testSkill({ draftId: 'd', skill: draft, agentId: 'forja', task: 't', projectPath: 'relativo' })).rejects.toThrow()
  })

  it('cria, e erros do serviço viram { ok: false, error }', async () => {
    const { h } = setup(async i => (i.prompt.includes('quero') ? '```skill\n' + toSkillMd(draft) + '```' : 'nada'))
    expect(await h.createSkill({ draftId: 'd', request: 'quero resumo', creatorId: 'forja' })).toEqual({ ok: true, skill: draft })
    expect(await h.createSkill({ draftId: 'd', request: 'outro', creatorId: 'forja' })).toEqual({ ok: false, error: 'INVALID_SKILL' })
    expect(await h.createSkill({ draftId: 'd', request: 'quero', creatorId: 'curinga' })).toEqual({ ok: false, error: 'PAID_NEEDS_CONFIRM' })
  })

  it('teste usa o projeto aberto como pasta', async () => {
    const { h, calls } = setup(async () => 'resposta')
    expect(await h.testSkill({ draftId: 'd', skill: draft, agentId: 'pincel', task: 't', projectPath: '/proj' })).toEqual({ ok: true, answer: 'resposta' })
    expect(calls[0].cwd).toBe('/proj')
  })

  it('cancelSkill aborta a execução do rascunho', async () => {
    const { h } = setup(i => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(new Error('CANCELED')))))
    const p = h.createSkill({ draftId: 'd9', request: 'x', creatorId: 'forja' })
    await new Promise(r => setTimeout(r, 10))
    h.cancelSkill('d9')
    expect(await p).toEqual({ ok: false, error: 'CANCELED' })
  })

  it('I-6: prazo estourado vira TIMEOUT', async () => {
    const { h } = setup(async () => { throw new Error('TIMEOUT') })
    expect(await h.createSkill({ draftId: 'd', request: 'x', creatorId: 'forja' })).toEqual({ ok: false, error: 'TIMEOUT' })
  })

  it('agente sem resposta ou com erro vira código próprio', async () => {
    expect(await setup(async () => '').h.createSkill({ draftId: 'd', request: 'x', creatorId: 'forja' })).toEqual({ ok: false, error: 'EMPTY_ANSWER' })
    expect(await setup(async () => { throw new Error('AGENT_ERROR') }).h.createSkill({ draftId: 'd', request: 'x', creatorId: 'forja' })).toEqual({ ok: false, error: 'AGENT_ERROR' })
  })

  it('salvar devolve erros de validação', async () => {
    const { h } = setup(async () => '')
    const ok = h.saveSkill({ id: '', ...draft, agentIds: ['forja'], updatedAt: 0 })
    expect(ok.ok).toBe(true)
    expect(h.saveSkill({ id: '', ...draft, agentIds: [], updatedAt: 0 })).toEqual({ ok: false, errors: ['Já existe uma skill chamada "resumo-3".'] })
    expect(h.skills()).toHaveLength(1)
  })
})
