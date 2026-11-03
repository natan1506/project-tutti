import { describe, expect, it } from 'vitest'
import { skillsInstructions, toSkillMd, type Skill } from '@shared/skills'
import { openStore } from '../../../src/main/store/db'
import { SkillService, type ConsultInput } from '../../../src/main/skills/skillService'

const draft = { name: 'resumo-3', description: 'Use quando pedirem um resumo.', body: 'Responda em 3 tópicos.' }
const signal = new AbortController().signal

function setup(answer: string | ((i: ConsultInput) => string), paid: string[] = []) {
  const calls: ConsultInput[] = []
  const store = openStore(':memory:')
  const svc = new SkillService({
    store, workDir: '/app/skill-work', isPaid: id => paid.includes(id),
    runs: { consultOnce: async i => { calls.push(i); return typeof answer === 'string' ? answer : answer(i) } },
  })
  return { svc, calls, store }
}
const md = '```skill\n' + toSkillMd(draft) + '```'

describe('SkillService', () => {
  it('create devolve o rascunho extraído, na pasta vazia, com uso no id do rascunho', async () => {
    const { svc, calls } = setup('Pronto:\n' + md)
    expect(await svc.create({ draftId: 'd1', request: 'resumo em três tópicos', creatorId: 'forja', signal })).toEqual(draft)
    expect(calls[0]).toMatchObject({ usageRunId: 'skill:d1', agentId: 'forja', cwd: '/app/skill-work' })
    expect(calls[0].prompt).toContain('resumo em três tópicos')
    expect(calls[0].prompt).toContain('```skill')
  })

  it('create sem skill válida na resposta: INVALID_SKILL', async () => {
    const { svc } = setup('não consigo')
    await expect(svc.create({ draftId: 'd1', request: 'x', creatorId: 'forja', signal })).rejects.toThrow('INVALID_SKILL')
  })

  it('resposta vazia: EMPTY_ANSWER (não "skill inválida")', async () => {
    const { svc } = setup('  ')
    await expect(svc.create({ draftId: 'd1', request: 'x', creatorId: 'forja', signal })).rejects.toThrow('EMPTY_ANSWER')
    await expect(svc.improve({ draftId: 'd1', skill: draft, creatorId: 'forja', task: 't', answer: 'a', signal })).rejects.toThrow('EMPTY_ANSWER')
  })

  it('agente pago sem confirmação: PAID_NEEDS_CONFIRM sem chamar o agente', async () => {
    const { svc, calls } = setup(md, ['kimi'])
    await expect(svc.create({ draftId: 'd1', request: 'x', creatorId: 'kimi', signal })).rejects.toThrow('PAID_NEEDS_CONFIRM')
    await expect(svc.test({ draftId: 'd1', skill: draft, agentId: 'kimi', task: 't', signal })).rejects.toThrow('PAID_NEEDS_CONFIRM')
    expect(calls).toHaveLength(0)
    expect(await svc.create({ draftId: 'd1', request: 'x', creatorId: 'kimi', confirmPaid: true, signal })).toEqual(draft)
  })

  it('test usa a skill nas instruções e o projeto (ou a pasta vazia)', async () => {
    const { svc, calls } = setup('- a\n- b\n- c')
    expect(await svc.test({ draftId: 'd1', skill: draft, agentId: 'pincel', task: 'resuma o README', cwd: '/proj', signal })).toBe('- a\n- b\n- c')
    expect(calls[0]).toMatchObject({ agentId: 'pincel', prompt: 'resuma o README', cwd: '/proj', instructions: skillsInstructions([draft]), usageRunId: 'skill:d1' })
    await svc.test({ draftId: 'd1', skill: draft, agentId: 'pincel', task: 't', signal })
    expect(calls[1].cwd).toBe('/app/skill-work')
  })

  it('improve sem comentário pede autoavaliação; com comentário, leva o comentário', async () => {
    const { svc, calls } = setup(md)
    const base = { draftId: 'd1', skill: draft, creatorId: 'forja', task: 'resuma X', answer: 'um parágrafo longo', signal }
    expect(await svc.improve(base)).toEqual(draft)
    for (const t of [draft.body, 'resuma X', 'um parágrafo longo', 'avalie se a resposta seguiu a skill']) expect(calls[0].prompt).toContain(t)
    await svc.improve({ ...base, feedback: 'use emojis' })
    expect(calls[1].prompt).toContain('use emojis')
  })

  it('save gera id, valida e skillsFor filtra por agente, por nome', () => {
    const { svc } = setup('')
    const a = svc.save({ id: '', ...draft, name: 'zeta', agentIds: ['forja'], updatedAt: 0 })
    expect(a.id).toMatch(/^sk_/)
    svc.save({ id: '', ...draft, name: 'alfa', agentIds: ['forja', 'pincel'], updatedAt: 0 })
    svc.save({ id: '', ...draft, name: 'beta', agentIds: ['pincel'], updatedAt: 0 })
    expect(svc.skillsFor('forja').map(s => s.name)).toEqual(['alfa', 'zeta'])
    expect(() => svc.save({ id: '', ...draft, name: 'alfa', agentIds: [], updatedAt: 0 } as Skill)).toThrow('Já existe uma skill chamada "alfa".')
    svc.remove(a.id)
    expect(svc.skillsFor('forja').map(s => s.name)).toEqual(['alfa'])
  })
})
