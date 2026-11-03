import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSkillMd } from '@shared/skills'
import { skillQualifiedName, writeClaudePlugin } from '../../../src/main/skills/claudePlugin'

const a = { name: 'alfa', description: 'Use em A.', body: 'Faça A.' }
const b = { name: 'beta', description: 'Use em B.', body: 'Faça B.' }
const base = () => join(mkdtempSync(join(tmpdir(), 'plug-')), 'forja')

describe('plugin de skills do Claude', () => {
  it('grava o plugin tutti e devolve os nomes qualificados', () => {
    const dir = base()
    const r = writeClaudePlugin(dir, [a, b])
    expect(dirname(r.path)).toBe(dir)
    expect(r.names).toEqual(['tutti:alfa', 'tutti:beta'])
    expect(JSON.parse(readFileSync(join(r.path, '.claude-plugin/plugin.json'), 'utf8')).name).toBe('tutti')
    expect(parseSkillMd(readFileSync(join(r.path, 'skills/alfa/SKILL.md'), 'utf8'))).toEqual(a)
  })

  it('I-4: mesmo conteúdo reaproveita a pasta; conteúdo novo vai para outra, sem apagar a que pode estar em uso', () => {
    const dir = base()
    const r1 = writeClaudePlugin(dir, [a, b])
    expect(writeClaudePlugin(dir, [a, b]).path).toBe(r1.path)
    const r2 = writeClaudePlugin(dir, [{ ...a, body: 'Novo A.' }])
    expect(r2.path).not.toBe(r1.path)
    expect(existsSync(join(r2.path, 'skills/beta'))).toBe(false)
    expect(readFileSync(join(r2.path, 'skills/alfa/SKILL.md'), 'utf8')).toContain('Novo A.')
    expect(existsSync(r1.path)).toBe(true)
  })

  it('I-4: pastas paradas há mais de um dia são apagadas', () => {
    const dir = base()
    const old = writeClaudePlugin(dir, [a]).path
    const ago = Date.now() / 1000 - 2 * 86_400
    utimesSync(old, ago, ago)
    mkdirSync(join(dir, 'lixo-tmp'))
    const r = writeClaudePlugin(dir, [b])
    expect(existsSync(old)).toBe(false)
    expect(readdirSync(dir)).toContain(r.path.split('/').at(-1))
  })

  it('nome qualificado', () => {
    expect(skillQualifiedName('alfa')).toBe('tutti:alfa')
  })
})
