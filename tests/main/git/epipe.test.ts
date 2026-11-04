import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runGit } from '../../../src/main/git/git'

describe('runGit', () => {
  it('git que termina sem ler a entrada não deixa erro de EPIPE solto', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'epipe-'))
    // `git --version` não lê a entrada: escrever 8 MB nela quebra o cano.
    for (let i = 0; i < 5; i++) expect(await runGit(dir, ['--version'], { input: 'x'.repeat(8_000_000) })).toMatch(/^git version/)
  })
})
