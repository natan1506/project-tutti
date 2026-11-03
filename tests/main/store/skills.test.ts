import { describe, expect, it } from 'vitest'
import { openStore } from '../../../src/main/store/db'

const s = (id: string, name: string) => ({ id, name, description: 'Quando usar.', body: 'Faça.', agentIds: ['forja'], updatedAt: 1 })

describe('store: skills', () => {
  it('salva, lista por nome, sobrescreve pelo id e exclui', () => {
    const db = openStore(':memory:')
    db.saveSkill(s('a', 'zeta'))
    db.saveSkill(s('b', 'alfa'))
    expect(db.listSkills().map(x => x.name)).toEqual(['alfa', 'zeta'])
    db.saveSkill({ ...s('a', 'zeta'), body: 'Outro.' })
    expect(db.listSkills()).toHaveLength(2)
    expect(db.listSkills().find(x => x.id === 'a')!.body).toBe('Outro.')
    db.deleteSkill('b')
    expect(db.listSkills().map(x => x.id)).toEqual(['a'])
  })
})
