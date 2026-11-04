import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runGit } from '../../../src/main/git/git'

// Revisão final (C2): um agente que escreve .git/commondir apontando para um repositório com filtro
// faria o git do app (fora do sandbox) executar o filtro no `add -A` do ponto de restauração.
describe('git do app ignora .git/commondir do projeto', () => {
  it('o filtro de outro repositório não roda', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cd-'))
    const proj = join(base, 'proj'), evil = join(base, 'evil.git'), marker = join(base, 'EXECUTOU')
    await runGit(base, ['init', '-q', proj])
    await runGit(base, ['init', '-q', '--bare', evil])
    writeFileSync(join(evil, 'config'), `[core]\n\trepositoryformatversion = 0\n\tbare = true\n[filter "x"]\n\tclean = touch ${marker}; cat\n`)
    writeFileSync(join(proj, '.gitattributes'), '* filter=x\n')
    writeFileSync(join(proj, 'a.txt'), 'a\n')
    writeFileSync(join(proj, '.git/commondir'), evil + '\n')
    await runGit(proj, ['add', '-A']).catch(() => {})
    expect(existsSync(marker)).toBe(false)
  })
})
