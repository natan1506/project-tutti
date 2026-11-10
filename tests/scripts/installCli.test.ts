import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// install.sh com um pacote falso servido por file://: instala, cria o comando e o comando roda com o Node da máquina.
function fakePackage(text: string) {
  const root = mkdtempSync(join(tmpdir(), 'pkg-'))
  mkdirSync(join(root, 'tutti', 'out', 'main'), { recursive: true })
  writeFileSync(join(root, 'tutti', 'out', 'main', 'cli.js'), `console.log(${JSON.stringify(text)} + ' ' + process.argv.slice(2).join(' '))`)
  const tgz = join(root, 'tutti-cli.tar.gz')
  execFileSync('tar', ['-czf', tgz, '-C', root, 'tutti'])
  return tgz
}
function install(tgz: string) {
  const home = mkdtempSync(join(tmpdir(), 'home-'))
  const env = { ...process.env, HOME: home, TUTTI_CLI_URL: `file://${tgz}`, PATH: process.env.PATH! }
  const out = execFileSync('sh', [resolve('scripts/install.sh')], { env, encoding: 'utf8' })
  return { home, out, bin: join(home, '.local', 'bin', 'tutti'), dir: join(home, '.local', 'share', 'tutti') }
}

// O Tutti só roda no macOS (o install.sh recusa outros sistemas); o CI roda em Linux.
describe.skipIf(process.platform !== 'darwin')('install.sh (só o terminal)', () => {
  it('instala em ~/.local/share/tutti, cria ~/.local/bin/tutti e o comando roda', () => {
    const r = install(fakePackage('versao-1'))
    expect(existsSync(join(r.dir, 'out', 'main', 'cli.js'))).toBe(true)
    expect(execFileSync(r.bin, ['--version'], { encoding: 'utf8' }).trim()).toBe('versao-1 --version')
    expect(readFileSync(r.bin, 'utf8')).toContain(process.execPath)
    expect(r.out).toContain('Tutti instalado')
  })
  it('instalar de novo substitui a versão anterior', () => {
    const tgz1 = fakePackage('versao-1'), tgz2 = fakePackage('versao-2')
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    for (const tgz of [tgz1, tgz2]) execFileSync('sh', [resolve('scripts/install.sh')], { env: { ...process.env, HOME: home, TUTTI_CLI_URL: `file://${tgz}` }, encoding: 'utf8' })
    expect(execFileSync(join(home, '.local', 'bin', 'tutti'), [], { encoding: 'utf8' }).trim()).toBe('versao-2')
  })
  it('sem ~/.local/bin no PATH, ensina a colocar', () => {
    const r = install(fakePackage('x'))
    expect(r.out).toContain('export PATH="$HOME/.local/bin:$PATH"')
  })
})
