import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runGit, isGitRepo, initRepo } from '../../../src/main/git/git'
import { snapshot, diffBetween, undo } from '../../../src/main/git/checkpoint'

async function makeRepo(sub = 'repo'): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), 'ck-')), sub)
  mkdirSync(dir, { recursive: true })
  await runGit(dir, ['init', '-q', '-b', 'main'])
  await runGit(dir, ['config', 'user.name', 'Natan'])
  await runGit(dir, ['config', 'user.email', 'n@x'])
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  writeFileSync(join(dir, 'b.txt'), Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`).join('\n') + '\n')
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
  await runGit(dir, ['add', '-A'])
  await runGit(dir, ['commit', '-q', '-m', 'inicial'])
  return dir
}
const read = (d: string, f: string) => readFileSync(join(d, f), 'utf8')
const setLine = (d: string, f: string, n: number, text: string) => {
  const lines = read(d, f).split('\n'); lines[n - 1] = text; writeFileSync(join(d, f), lines.join('\n'))
}
const visibleState = async (d: string) => ({
  status: await runGit(d, ['status', '--porcelain']),
  head: await runGit(d, ['rev-parse', 'HEAD']),
  branch: await runGit(d, ['branch', '--show-current']),
  stash: await runGit(d, ['stash', 'list']),
})

/** Repo sujo + snapshot before + "agente" muda b.txt (linha 2) e cria c.txt + snapshot after. */
async function agentRun(dir: string) {
  writeFileSync(join(dir, 'a.txt'), 'a do natan\n')
  writeFileSync(join(dir, 'novo.txt'), 'não rastreado\n')
  mkdirSync(join(dir, 'node_modules')); writeFileSync(join(dir, 'node_modules/x.js'), 'x')
  await snapshot(dir, 'refs/time/runs/r1/before')
  setLine(dir, 'b.txt', 2, 'linha 2 do agente')
  writeFileSync(join(dir, 'c.txt'), 'c\n')
  await snapshot(dir, 'refs/time/runs/r1/after')
}
const B = 'refs/time/runs/r1/before', A = 'refs/time/runs/r1/after'

describe('snapshot', () => {
  it('não altera nada visível ao Natan', async () => {
    const dir = await makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'mudado\n'); writeFileSync(join(dir, 'novo.txt'), 'n')
    const before = await visibleState(dir)
    await snapshot(dir, B)
    expect(await visibleState(dir)).toEqual(before)
    expect(await runGit(dir, ['rev-parse', B])).toMatch(/^[0-9a-f]{40}/)
  })
})

describe('diffBetween', () => {
  it('mostra só o que o agente mudou num repo sujo', async () => {
    const dir = await makeRepo()
    await agentRun(dir)
    const files = await diffBetween(dir, B, A)
    expect(files).toEqual([
      { path: 'b.txt', status: 'M', added: 1, removed: 1 },
      { path: 'c.txt', status: 'A', added: 1, removed: 0 },
    ])
  })
})

describe('undo', () => {
  it('reverte tudo do agente e mantém o que era do Natan', async () => {
    const dir = await makeRepo()
    await agentRun(dir)
    expect(await undo(dir, B, A)).toEqual({ ok: true })
    expect(read(dir, 'b.txt').split('\n')[1]).toBe('linha 2')
    expect(existsSync(join(dir, 'c.txt'))).toBe(false)
    expect(read(dir, 'a.txt')).toBe('a do natan\n')
    expect(existsSync(join(dir, 'novo.txt'))).toBe(true)
  })

  it('reverte só os arquivos pedidos', async () => {
    const dir = await makeRepo()
    await agentRun(dir)
    expect(await undo(dir, B, A, ['c.txt'])).toEqual({ ok: true })
    expect(existsSync(join(dir, 'c.txt'))).toBe(false)
    expect(read(dir, 'b.txt').split('\n')[1]).toBe('linha 2 do agente')
  })

  it('preserva edição do Natan feita depois, sem sobreposição', async () => {
    const dir = await makeRepo()
    await agentRun(dir)
    setLine(dir, 'b.txt', 18, 'linha 18 do natan')
    expect(await undo(dir, B, A)).toEqual({ ok: true })
    const lines = read(dir, 'b.txt').split('\n')
    expect(lines[1]).toBe('linha 2')
    expect(lines[17]).toBe('linha 18 do natan')
  })

  it('reporta conflito e não mexe em nada quando se sobrepõe', async () => {
    const dir = await makeRepo()
    await agentRun(dir)
    setLine(dir, 'b.txt', 2, 'linha 2 do natan')
    const bAntes = read(dir, 'b.txt')
    expect(await undo(dir, B, A)).toEqual({ ok: false, conflicts: ['b.txt'] })
    expect(read(dir, 'b.txt')).toBe(bAntes)
    expect(existsSync(join(dir, 'c.txt'))).toBe(true)
  })
})

describe('caminhos com espaço e acento', () => {
  it('snapshot, diff e undo funcionam', async () => {
    const dir = await makeRepo('Meus Projetos/ação')
    await snapshot(dir, B)
    mkdirSync(join(dir, 'pasta x')); writeFileSync(join(dir, 'pasta x/ç.txt'), 'ç\n')
    await snapshot(dir, A)
    expect(await diffBetween(dir, B, A)).toEqual([{ path: 'pasta x/ç.txt', status: 'A', added: 1, removed: 0 }])
    expect(await undo(dir, B, A)).toEqual({ ok: true })
    expect(existsSync(join(dir, 'pasta x/ç.txt'))).toBe(false)
  })
})

describe('isGitRepo / initRepo', () => {
  it('detecta e inicia repositório sem criar commits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nogit-'))
    expect(await isGitRepo(dir)).toBe(false)
    await initRepo(dir)
    expect(await isGitRepo(dir)).toBe(true)
    await expect(runGit(dir, ['rev-parse', 'HEAD'])).rejects.toThrow()
  })

  it('snapshot funciona num repo sem nenhum commit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'empty-'))
    await initRepo(dir)
    await snapshot(dir, B)
    writeFileSync(join(dir, 'n.txt'), 'n\n')
    await snapshot(dir, A)
    expect(await diffBetween(dir, B, A)).toEqual([{ path: 'n.txt', status: 'A', added: 1, removed: 0 }])
  })
})
