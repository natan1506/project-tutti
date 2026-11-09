import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KeyStore } from '../../../src/main/keys/keyStore'
import { McpService } from '../../../src/main/mcp/mcpService'
import { probeMcp } from '../../../src/main/mcp/probe'
import { openStore } from '../../../src/main/store/db'

const FAKE = resolve('tests/main/mcp/fixtures/fake-mcp.mjs')
const crypto = { isAvailable: () => true, encrypt: (s: string) => Buffer.from(`enc:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^enc:/, '') }

function setup(claudeJson?: object) {
  const home = mkdtempSync(join(tmpdir(), 'home-'))
  if (claudeJson) writeFileSync(join(home, '.claude.json'), JSON.stringify(claudeJson))
  const store = openStore(':memory:')
  const keys = new KeyStore({ store, crypto })
  const svc = new McpService({ store, keys, homeDir: home })
  return { svc, store, home }
}
const fakeDef = (o: object = {}) => ({ id: '', nome: 'fake', transport: { kind: 'stdio', command: process.execPath, args: [FAKE] }, secretNames: [], mode: 'read', agents: 'all', enabled: true, tools: [], ...o })

describe('probe', () => {
  it('conecta num MCP de verdade e lista as ferramentas', async () => {
    const r = await probeMcp(fakeDef() as never, {})
    expect(r.ok && r.tools.map(t => t.name).sort()).toEqual(['get_secret', 'get_thing', 'save_thing'])
  }, 20000)
  it('comando que não existe vira erro, sem lançar', async () => {
    const r = await probeMcp(fakeDef({ transport: { kind: 'stdio', command: '/nao/existe', args: [] } }) as never, {}, 3000)
    expect(r.ok).toBe(false)
  }, 20000)
})

describe('McpService', () => {
  it('salvar testa, classifica as ferramentas e liga', async () => {
    const { svc } = setup()
    const r = await svc.save(fakeDef())
    expect(r.ok).toBe(true)
    const d = svc.all()[0]
    expect(d.enabled).toBe(true)
    expect(d.tools).toEqual([{ name: 'get_secret', read: true }, { name: 'get_thing', read: true }, { name: 'save_thing', read: false }])
  }, 20000)

  it('MCP que não conecta é salvo desligado, com o erro', async () => {
    const { svc } = setup()
    const r = await svc.save(fakeDef({ nome: 'quebrado', transport: { kind: 'stdio', command: '/nao/existe', args: [] } }))
    expect(r.ok).toBe(true)
    expect(svc.all()[0]).toMatchObject({ enabled: false, lastError: expect.any(String) })
  }, 20000)

  it('segredo vai para o Keychain, chega ao MCP e nunca fica no banco nem na lista', async () => {
    const { svc, store } = setup()
    await svc.save(fakeDef({ secretNames: ['FAKE_TOKEN'] }), { FAKE_TOKEN: 'segredo-123' })
    const d = svc.all()[0]
    expect(JSON.stringify(svc.all())).not.toContain('segredo-123')
    expect(JSON.stringify(store.getSetting('mcps'))).not.toContain('segredo-123')
    expect(svc.secretsOf(d.id)).toEqual({ FAKE_TOKEN: 'segredo-123' })
  }, 20000)

  it('importa do Claude Code: Linear só leitura; Playwright desligado; env vira segredo', async () => {
    const { svc } = setup({ mcpServers: {
      linear: { type: 'stdio', command: process.execPath, args: [FAKE], env: { FAKE_TOKEN: 'tok' } },
      playwright: { type: 'stdio', command: process.execPath, args: [FAKE] },
    } })
    expect(svc.importableFromClaudeCode().map(i => i.nome)).toEqual(['linear', 'playwright'])
    await svc.importFromClaudeCode('linear')
    await svc.importFromClaudeCode('playwright')
    const [l, p] = svc.all()
    expect(l).toMatchObject({ nome: 'linear', mode: 'read', source: 'claude-code', secretNames: ['FAKE_TOKEN'], enabled: true })
    expect(JSON.stringify(l)).not.toContain('tok"')
    expect(p).toMatchObject({ nome: 'playwright', enabled: false })
    expect(svc.importableFromClaudeCode()).toEqual([])
  }, 30000)

  it('seedLinear cria o Linear uma vez só', async () => {
    const { svc } = setup({ mcpServers: { linear: { type: 'stdio', command: process.execPath, args: [FAKE] } } })
    await svc.seedLinear()
    await svc.seedLinear()
    expect(svc.all().map(d => d.nome)).toEqual(['linear'])
  }, 20000)

  it('setTool troca uma ferramenta de lado; setEnabled e remove', async () => {
    const { svc } = setup()
    await svc.save(fakeDef())
    const id = svc.all()[0].id
    svc.setTool(id, 'save_thing', true)
    expect(svc.all()[0].tools.find(t => t.name === 'save_thing')!.read).toBe(true)
    svc.setEnabled(id, false)
    expect(svc.all()[0].enabled).toBe(false)
    svc.remove(id)
    expect(svc.all()).toEqual([])
  }, 20000)
})

describe('revisão: gravações durante o teste de conexão', () => {
  it('mudança feita enquanto outro MCP testa a conexão não se perde; nome repetido ao mesmo tempo é recusado', async () => {
    const { svc } = setup()
    await svc.save(fakeDef({ nome: 'a' }))
    const id = svc.all()[0].id
    const slow = svc.save(fakeDef({ nome: 'b' }))
    svc.setEnabled(id, false)
    const dup = svc.save(fakeDef({ nome: 'b' }))
    const [r1, r2] = await Promise.all([slow, dup])
    expect(svc.all().find(d => d.nome === 'a')!.enabled).toBe(false)
    expect([r1.ok, r2.ok].sort()).toEqual([false, true])
    expect(svc.all().filter(d => d.nome === 'b')).toHaveLength(1)
  }, 30000)
  it('"testar de novo" com ferramenta nova: entra como escrita até você rever', async () => {
    const { svc } = setup()
    await svc.save(fakeDef())
    const d = svc.all()[0]
    svc['write']([{ ...d, tools: d.tools.filter(t => t.name !== 'get_secret') }])
    await svc.save({ ...svc.all()[0], enabled: true })
    expect(svc.all()[0].tools.find(t => t.name === 'get_secret')!.read).toBe(false)
  }, 30000)
  it('mudar modo e agentes de um MCP existente sem perder as ferramentas reclassificadas', async () => {
    const { svc } = setup()
    await svc.save(fakeDef())
    const id = svc.all()[0].id
    svc.setTool(id, 'save_thing', true)
    svc.setAccess(id, 'write', ['forja'])
    expect(svc.all()[0]).toMatchObject({ mode: 'write', agents: ['forja'] })
    expect(svc.all()[0].tools.find(t => t.name === 'save_thing')!.read).toBe(true)
  }, 30000)
})
