import { describe, expect, it } from 'vitest'
// @ts-expect-error script .mjs sem tipos
import { cleanStrayApps, LSREGISTER } from '../../scripts/lib/stray-apps.mjs'

function fakeMac(files: string[], dirs: Record<string, string[]>) {
  const calls: string[] = []
  const removed: string[] = []
  cleanStrayApps({
    root: '/repo',
    home: '/Users/n',
    exists: (p: string) => files.includes(p),
    list: (p: string) => dirs[p] ?? [],
    run: (cmd: string, args: string[]) => { calls.push([cmd === LSREGISTER ? 'ls' : cmd, ...args].join(' ')) },
    rm: (p: string) => { removed.push(p) },
    log: () => {},
  })
  return { calls, removed }
}

describe('limpeza de cópias soltas do Tutti', () => {
  it('apaga os apps que o build deixa em release/ e tira do registro do macOS', () => {
    const { calls, removed } = fakeMac(['/repo/release/mac/Tutti.app', '/repo/release/mac-arm64/Tutti.app'], {})
    expect(calls).toContain('ls -u /repo/release/mac/Tutti.app')
    expect(calls).toContain('ls -u /repo/release/mac-arm64/Tutti.app')
    expect(removed).toEqual(['/repo/release/mac', '/repo/release/mac-arm64', '/repo/release/mac-universal'])
  })

  it('ejeta os instaladores do Tutti que ficaram montados, sem mexer em outros discos', () => {
    const { calls } = fakeMac([], { '/Volumes': ['Tutti 0.5.0', 'Tutti 0.4.0-arm64', 'Macintosh HD', 'Outro'] })
    expect(calls).toContain('ls -u /Volumes/Tutti 0.5.0/Tutti.app')
    expect(calls).toContain('hdiutil detach /Volumes/Tutti 0.5.0')
    expect(calls).toContain('hdiutil detach /Volumes/Tutti 0.4.0-arm64')
    expect(calls.some(c => c.includes('Macintosh HD') || c.includes('Outro'))).toBe(false)
  })

  it('tira do registro o Tutti da Lixeira sem apagar nada lá', () => {
    const { calls, removed } = fakeMac([], { '/Users/n/.Trash': ['Tutti.app', 'Tutti 2.app', 'foto.png'] })
    expect(calls).toContain('ls -u /Users/n/.Trash/Tutti.app')
    expect(calls).toContain('ls -u /Users/n/.Trash/Tutti 2.app')
    expect(removed.some(p => p.includes('.Trash'))).toBe(false)
  })

  it('reforça o registro do Tutti instalado em /Applications', () => {
    const { calls } = fakeMac(['/Applications/Tutti.app'], {})
    expect(calls).toContain('ls -f /Applications/Tutti.app')
  })
})
