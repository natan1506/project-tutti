import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadInstructions } from '../../../src/main/instructions/loadInstructions'

let home: string, proj: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'home-'))
  proj = mkdtempSync(join(tmpdir(), 'proj-'))
})

describe('loadInstructions', () => {
  it('retorna vazio sem arquivos', async () => {
    expect(await loadInstructions(proj, home)).toBe('')
  })

  it('junta as quatro fontes na ordem, com cabeçalhos', async () => {
    mkdirSync(join(home, '.claude')); mkdirSync(join(home, '.codex'))
    writeFileSync(join(home, '.claude/CLAUDE.md'), 'G')
    writeFileSync(join(home, '.codex/AGENTS.md'), 'C')
    writeFileSync(join(proj, 'CLAUDE.md'), 'P')
    writeFileSync(join(proj, 'AGENTS.md'), 'A')
    const out = await loadInstructions(proj, home)
    const order = [
      '## Instruções globais (CLAUDE.md)\n\nG',
      '## Instruções globais (Codex AGENTS.md)\n\nC',
      '## Instruções do projeto (CLAUDE.md)\n\nP',
      '## Instruções do projeto (AGENTS.md)\n\nA',
    ].map(s => out.indexOf(s))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('ignora arquivo vazio', async () => {
    writeFileSync(join(proj, 'CLAUDE.md'), '  \n ')
    writeFileSync(join(proj, 'AGENTS.md'), 'A')
    const out = await loadInstructions(proj, home)
    expect(out).not.toContain('CLAUDE.md')
    expect(out).toContain('## Instruções do projeto (AGENTS.md)')
  })
})
