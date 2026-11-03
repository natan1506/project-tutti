import { describe, expect, it } from 'vitest'
import { parseSkillMd, skillsInstructions, toSkillMd, validateSkill } from '@shared/skills'

const d = { name: 'revisar-sql', description: 'Use ao revisar queries SQL.', body: '# Passos\n1. Leia a query.' }

describe('skills', () => {
  it('ida e volta do SKILL.md', () => {
    expect(parseSkillMd(toSkillMd(d))).toEqual(d)
  })

  it('extrai do bloco skill no meio da resposta', () => {
    const r = 'Aqui está:\n```skill\n' + toSkillMd(d) + '\n```\nQualquer coisa.'
    expect(parseSkillMd(r)).toEqual(d)
  })

  it('resposta sem skill válida vira null', () => {
    expect(parseSkillMd('não sei fazer')).toBeNull()
    expect(parseSkillMd('```skill\nsem frontmatter\n```')).toBeNull()
    expect(parseSkillMd('---\nname: Nome Ruim\ndescription: x\n---\ncorpo')).toBeNull()
    expect(parseSkillMd('---\nname: ok\ndescription: x\n---\n   ')).toBeNull()
  })

  it('validação', () => {
    const s = { id: 's1', ...d, agentIds: [], updatedAt: 0 }
    expect(validateSkill(s, []).ok).toBe(true)
    const r = validateSkill({ ...s, id: 's2' }, [s])
    expect(r.ok === false && r.errors).toContain('Já existe uma skill chamada "revisar-sql".')
    expect(validateSkill(s, [s]).ok).toBe(true) // ela mesma não conta
    expect(validateSkill({ ...s, description: '' }, []).ok).toBe(false)
    expect(validateSkill({ ...s, body: 'x'.repeat(20_001) }, []).ok).toBe(false)
    expect(validateSkill({ ...s, name: 'a'.repeat(65) }, []).ok).toBe(false)
    expect(validateSkill({ ...s, name: 'Com Espaço' }, []).ok).toBe(false)
    expect(validateSkill('lixo', []).ok).toBe(false)
  })

  it('instruções listam nome, quando usar e corpo', () => {
    const t = skillsInstructions([d])
    expect(t).toContain('revisar-sql')
    expect(t).toContain('Use ao revisar queries SQL.')
    expect(t).toContain('1. Leia a query.')
    expect(skillsInstructions([])).toBe('')
  })
})
