import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pickExecutable } from '../../../src/main/adapters/executables'

function pathWith(name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'bin-'))
  const f = join(dir, name)
  writeFileSync(f, '#!/bin/sh\n')
  chmodSync(f, 0o755)
  return { dir, f }
}

describe('qual claude/codex o Tutti usa', () => {
  it('com o binário embutido do SDK (o app), usa o embutido', () => {
    expect(pickExecutable('claude', { hasBundled: true, path: pathWith('claude').dir })).toBeUndefined()
  })
  it('sem o embutido (pacote só do terminal), usa o instalado na máquina', () => {
    const p = pathWith('codex')
    expect(pickExecutable('codex', { hasBundled: false, path: `/nao/existe:${p.dir}` })).toBe(p.f)
  })
  it('sem nenhum dos dois, undefined (o SDK avisa que falta a ferramenta)', () => {
    expect(pickExecutable('claude', { hasBundled: false, path: mkdtempSync(join(tmpdir(), 'vazio-')) })).toBeUndefined()
  })
})
