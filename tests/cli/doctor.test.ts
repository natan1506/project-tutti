import { describe, expect, it } from 'vitest'
import type { ToolStatus } from '@shared/models'
import { checkupLines } from '../../src/cli/doctor'

const st = (tool: string, installed: boolean, loggedIn: boolean): ToolStatus => ({ tool: tool as never, installed, loggedIn })
const team = [{ nome: 'Bússola', tool: 'claude' as const }, { nome: 'Forja', tool: 'codex' as const }, { nome: 'Lupa', tool: 'codex' as const }, { nome: 'Curinga', tool: 'opencode' as const }]
const all = (o: Partial<Record<string, ToolStatus>> = {}) => ({ claude: st('claude', true, true), codex: st('codex', true, true), gemini: st('gemini', true, true), opencode: st('opencode', true, true), ...o }) as never

describe('checagem da primeira abertura', () => {
  it('tudo pronto: uma linha verde só', () => {
    const r = checkupLines({ team, tools: all(), node: '24.22.0', git: true })
    expect(r.ok).toBe(true)
    expect(r.lines).toEqual([{ text: '✓ Tudo pronto: Claude, Codex e opencode instalados e logados.', color: 'green' }])
  })
  it('ferramenta faltando ou sem login: diz qual agente para e como resolver', () => {
    const r = checkupLines({ team, tools: all({ codex: st('codex', true, false), opencode: st('opencode', false, false) }), node: '24.22.0', git: true })
    expect(r.ok).toBe(false)
    const t = r.lines.map(l => l.text).join('\n')
    expect(t).toContain('Forja e Lupa (Codex): falta entrar. Rode `codex login`.')
    expect(t).toContain('Curinga (opencode): não está instalado. Instale com `npm install -g opencode-ai`.')
    expect(t).not.toContain('Bússola')
  })
  it('Node antigo e pasta sem git também aparecem', () => {
    const r = checkupLines({ team, tools: all(), node: '20.11.0', git: false })
    const t = r.lines.map(l => l.text).join('\n')
    expect(t).toContain('Node 20.11.0: o Tutti precisa do 22.13 ou mais novo.')
    expect(t).toContain('Pasta sem git: o /undo não funciona aqui (rode `git init` para ter).')
  })
  it('rodando dentro do app (Node do Electron), não confere o Node', () => {
    const r = checkupLines({ team, tools: all(), node: undefined, git: true })
    expect(r.ok).toBe(true)
  })
})
