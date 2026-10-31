// Integração real com o opencode instalado. Só roda com OPENCODE_IT=1 (gasta uma chamada de modelo gratuito).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getAgent } from '@shared/agents'
import type { AgentEvent } from '@shared/events'
import { OpencodeAdapter, OpencodeHost, startOpencodeServer } from '../../../src/main/adapters/opencode'

describe.runIf(process.env.OPENCODE_IT === '1')('opencode real', () => {
  it('cria arquivo, pede aprovação do npm install, respeita a negativa e fecha o servidor', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oc-it-'))
    writeFileSync(join(cwd, 'package.json'), '{"name":"x","version":"1.0.0"}\n')
    const asked: string[] = []
    const host = new OpencodeHost(() => startOpencodeServer())
    const evs: AgentEvent[] = []
    try {
    for await (const e of new OpencodeAdapter(host).run({
      agent: getAgent('curinga'), cwd, instructions: '', signal: new AbortController().signal,
      prompt: 'Crie o arquivo a.txt com "a". Depois rode o comando `npm install left-pad`. Responda curto.',
      requestApproval: async r => { asked.push(r.summary); return false },
    })) evs.push(e)
    } finally { await host.close() }
    const alive = () => { try { return execFileSync('pgrep', ['-f', 'opencode serve --hostname=127.0.0.1 --port=0'], { encoding: 'utf8' }).trim() } catch { return '' } }
    for (let i = 0; i < 50 && alive(); i++) await new Promise(r => setTimeout(r, 100))
    expect(existsSync(join(cwd, 'a.txt'))).toBe(true)
    expect(asked.some(s => s.includes('npm install left-pad'))).toBe(true)
    expect(readFileSync(join(cwd, 'package.json'), 'utf8')).not.toContain('left-pad')
    expect(evs.at(-1)?.type).toBe('done')
    expect(alive()).toBe('')
  }, 240_000)
})
