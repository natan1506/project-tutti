import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cachedDetector, detectTools, type Exec } from '../../../src/main/tools/detect'

const home = () => mkdtempSync(join(tmpdir(), 'home-'))
const exec = (installed: Record<string, string | null>): Exec => async cmd =>
  installed[cmd] ? { code: 0, stdout: installed[cmd]!, stderr: '' } : { code: 127, stdout: '', stderr: 'not found' }
const ALL = { claude: '2.1.304 (Claude Code)', codex: 'codex-cli 0.163.0', agy: '1.4.11', opencode: 'opencode v2.2.5' }

function loggedHome(): string {
  const h = home()
  mkdirSync(join(h, '.gemini/antigravity-cli'), { recursive: true })
  writeFileSync(join(h, '.gemini/antigravity-cli/antigravity-oauth-token'), 'x')
  return h
}

describe('detectTools', () => {
  it('tudo instalado e logado', async () => {
    const t = await detectTools(exec(ALL), loggedHome())
    expect(t.claude).toMatchObject({ installed: true, loggedIn: true, version: '2.1.304' })
    expect(t.codex).toMatchObject({ installed: true, loggedIn: true, version: '0.163.0' })
    expect(t.gemini).toMatchObject({ installed: true, loggedIn: true, version: '1.4.11' })
    expect(t.opencode).toMatchObject({ installed: true, loggedIn: true, version: '2.2.5' })
    expect(Object.values(t).every(s => s.hint === undefined)).toBe(true)
  })

  it('Antigravity ausente pede instalação', async () => {
    const t = await detectTools(exec({ ...ALL, agy: null }), loggedHome())
    expect(t.gemini).toEqual({ tool: 'gemini', installed: false, loggedIn: false, hint: 'Instale o Antigravity' })
  })

  it('Antigravity instalado sem login pede para entrar', async () => {
    const t = await detectTools(exec(ALL), home())
    expect(t.gemini).toMatchObject({ installed: true, loggedIn: false, hint: 'Entre no Antigravity' })
  })

  it('opencode ausente pede instalação; instalado não exige login (modelos gratuitos)', async () => {
    expect((await detectTools(exec({ ...ALL, opencode: null }), loggedHome())).opencode.hint).toBe('Instale o opencode')
    expect((await detectTools(exec(ALL), home())).opencode).toMatchObject({ installed: true, loggedIn: true })
  })

  it('exec que lança conta como não instalado', async () => {
    const t = await detectTools(async () => { throw new Error('ENOENT') }, loggedHome())
    expect(t.codex).toMatchObject({ installed: false, hint: 'Instale o Codex' })
  })
})

describe('cachedDetector', () => {
  it('reaproveita o resultado dentro do prazo e refaz depois', async () => {
    let calls = 0
    const counting: Exec = async cmd => { calls++; return exec(ALL)(cmd, []) }
    let now = 0
    const get = cachedDetector(counting, 60_000, () => now, loggedHome())
    await get(); await get()
    expect(calls).toBe(4)
    now = 60_001
    await get()
    expect(calls).toBe(8)
  })
})
