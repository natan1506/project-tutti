import { describe, expect, it, vi } from 'vitest'
import { splitCommandLine } from '@shared/mcp'
import { mcpHandlers } from '../../../src/main/mcp/mcpIpc'

const def = { id: 'm1', nome: 'fake', transport: { kind: 'stdio', command: 'node', args: [] }, secretNames: ['TOKEN'], mode: 'read', agents: 'all', enabled: true, tools: [] }
function svc() {
  return {
    all: vi.fn(() => [def]), save: vi.fn(async () => ({ ok: true, def })), remove: vi.fn(), setTool: vi.fn(), setEnabled: vi.fn(),
    importableFromClaudeCode: vi.fn(() => [{ nome: 'linear', transport: { kind: 'stdio', command: 'npx', args: [] } }]),
    importFromClaudeCode: vi.fn(async () => ({ ok: true, def })), secretsOf: vi.fn(() => ({ TOKEN: 'segredo' })),
  }
}

describe('IPC dos MCPs', () => {
  it('lista sem segredos', () => {
    const h = mcpHandlers(svc() as never)
    expect(JSON.stringify(h.mcps())).not.toContain('segredo')
  })
  it('salvar repassa def e segredos; segredo nunca volta na resposta', async () => {
    const s = svc()
    const r = await mcpHandlers(s as never).saveMcp({ def, secrets: { TOKEN: 'segredo' } })
    expect(s.save).toHaveBeenCalledWith(def, { TOKEN: 'segredo' })
    expect(JSON.stringify(r)).not.toContain('segredo')
  })
  it('recusa entrada inválida', async () => {
    const h = mcpHandlers(svc() as never)
    expect(await h.saveMcp({ def, secrets: { 'NOME RUIM': 'x' } })).toEqual({ ok: false, errors: ['Pedido inválido.'] })
    expect(() => h.setMcpTool({ id: 'm1', tool: 'x', read: 'sim' })).toThrow()
    expect(() => h.setMcpEnabled({ id: 5, enabled: true })).toThrow()
  })
  it('importar, ligar/desligar, trocar ferramenta, remover e testar de novo', async () => {
    const s = svc()
    const h = mcpHandlers(s as never)
    expect(h.mcpImportable()).toEqual([{ nome: 'linear', transport: { kind: 'stdio', command: 'npx', args: [] } }])
    await h.importMcp('linear')
    expect(s.importFromClaudeCode).toHaveBeenCalledWith('linear')
    h.setMcpEnabled({ id: 'm1', enabled: false })
    h.setMcpTool({ id: 'm1', tool: 'get_x', read: false })
    h.removeMcp('m1')
    await h.retestMcp('m1')
    expect(s.setEnabled).toHaveBeenCalledWith('m1', false)
    expect(s.setTool).toHaveBeenCalledWith('m1', 'get_x', false)
    expect(s.remove).toHaveBeenCalledWith('m1')
    expect(s.save).toHaveBeenCalledWith({ ...def, enabled: true }, {})
  })
})

describe('linha de comando do formulário', () => {
  it('separa como o shell, respeitando aspas', () => {
    expect(splitCommandLine('npx -y mcp-remote https://mcp.linear.app/mcp')).toEqual(['npx', '-y', 'mcp-remote', 'https://mcp.linear.app/mcp'])
    expect(splitCommandLine(`node "/caminho com espaço/x.js" --nome 'a b'`)).toEqual(['node', '/caminho com espaço/x.js', '--nome', 'a b'])
    expect(splitCommandLine('   ')).toEqual([])
  })
})
