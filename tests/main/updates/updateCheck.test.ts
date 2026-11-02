import { describe, expect, it } from 'vitest'
import { checkForUpdate, isNewer } from '../../../src/main/updates/updateCheck'

const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('isNewer', () => {
  it.each([
    ['v0.2.0', '0.1.0', true], ['0.1.1', '0.1.0', true], ['1.0.0', '0.9.9', true], ['0.10.0', '0.9.0', true],
    ['v0.1.0', '0.1.0', false], ['0.0.9', '0.1.0', false], ['lixo', '0.1.0', false],
  ])('%s é mais nova que %s? %s', (latest, current, expected) => expect(isNewer(latest, current)).toBe(expected))
})

describe('checkForUpdate', () => {
  const release = { tag_name: 'v0.2.0', html_url: 'https://github.com/natan1506/project-tutti/releases/tag/v0.2.0', draft: false, prerelease: false }
  it('release mais nova: versão e página da release', async () => {
    expect(await checkForUpdate('0.1.0', respond(200, release))).toEqual({ version: '0.2.0', url: release.html_url })
  })
  it('mesma versão: nada', async () => {
    expect(await checkForUpdate('0.2.0', respond(200, release))).toBeNull()
  })
  it('repositório privado (404), erro de rede ou resposta estranha: nada, sem lançar', async () => {
    expect(await checkForUpdate('0.1.0', respond(404, { message: 'Not Found' }))).toBeNull()
    expect(await checkForUpdate('0.1.0', (async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBeNull()
    expect(await checkForUpdate('0.1.0', respond(200, { tag_name: 'v9.9.9', html_url: 'https://evil.example/x' }))).toBeNull()
  })
})
