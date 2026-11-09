import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installLauncher, launcherScript } from '../../src/main/cliLauncher'

const EXE = '/Applications/Tutti.app/Contents/MacOS/Tutti'
const ENTRY = '/Applications/Tutti.app/Contents/Resources/app.asar/out/main/cli.js'

describe('comando tutti', () => {
  it('o script roda o núcleo com o Node do app, com aspas nos caminhos', () => {
    expect(launcherScript(EXE, ENTRY)).toBe(`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${EXE}" "${ENTRY}" "$@"\n`)
    expect(launcherScript('/Apps/Meu Tutti.app/x', '/y z/cli.js')).toContain('"/Apps/Meu Tutti.app/x" "/y z/cli.js"')
  })
  it('instala, não mexe se já está igual, atualiza se o app mudou de lugar', () => {
    const binDir = join(mkdtempSync(join(tmpdir(), 'bin-')), 'nao-existe', 'bin')
    expect(installLauncher({ exePath: EXE, entryPath: ENTRY, binDir })).toBe('installed')
    const file = join(binDir, 'tutti')
    expect(statSync(file).mode & 0o111).toBe(0o111)
    expect(installLauncher({ exePath: EXE, entryPath: ENTRY, binDir })).toBe('unchanged')
    expect(installLauncher({ exePath: '/Outro/Tutti', entryPath: ENTRY, binDir })).toBe('updated')
    expect(readFileSync(file, 'utf8')).toContain('/Outro/Tutti')
  })
})
