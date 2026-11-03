import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSkillMd } from '@shared/skills'
import { skillQualifiedName, writeClaudePlugin } from '../../../src/main/skills/claudePlugin'

const a = { name: 'alfa', description: 'Use em A.', body: 'Faça A.' }
const b = { name: 'beta', description: 'Use em B.', body: 'Faça B.' }

describe('plugin de skills do Claude', () => {
  it('grava o plugin tutti e devolve os nomes qualificados', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'plug-')), 'forja')
    const r = writeClaudePlugin(dir, [a, b])
    expect(r).toEqual({ path: dir, names: ['tutti:alfa', 'tutti:beta'] })
    expect(JSON.parse(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8')).name).toBe('tutti')
    expect(parseSkillMd(readFileSync(join(dir, 'skills/alfa/SKILL.md'), 'utf8'))).toEqual(a)
  })

  it('regravar com uma skill a menos apaga a que saiu', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'plug-')), 'forja')
    writeClaudePlugin(dir, [a, b])
    writeClaudePlugin(dir, [{ ...a, body: 'Novo A.' }])
    expect(existsSync(join(dir, 'skills/beta'))).toBe(false)
    expect(readFileSync(join(dir, 'skills/alfa/SKILL.md'), 'utf8')).toContain('Novo A.')
  })

  it('nome qualificado', () => {
    expect(skillQualifiedName('alfa')).toBe('tutti:alfa')
  })
})
