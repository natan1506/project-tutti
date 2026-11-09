// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpsScreen } from '../../src/renderer/components/McpsScreen'
import { useMcpStore } from '../../src/renderer/state/mcpStore'
import { useProfileStore } from '../../src/renderer/state/profileStore'
import { PADRAO } from '@shared/profiles'

const linear = { id: 'm1', nome: 'linear', transport: { kind: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'] }, secretNames: [], mode: 'read', agents: 'all', enabled: true,
  tools: [{ name: 'get_issue', read: true }, { name: 'save_issue', read: false }], source: 'claude-code' }
let api: Record<string, ReturnType<typeof vi.fn>>
beforeEach(() => {
  api = {
    mcps: vi.fn(async () => [linear]), saveMcp: vi.fn(async () => ({ ok: true, def: linear })), removeMcp: vi.fn(async () => {}),
    setMcpTool: vi.fn(async () => {}), setMcpEnabled: vi.fn(async () => {}), retestMcp: vi.fn(async () => ({ ok: true, def: linear })),
    mcpImportable: vi.fn(async () => [{ nome: 'playwright', transport: { kind: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'] } }]),
    importMcp: vi.fn(async () => ({ ok: true, def: linear })),
  }
  ;(window as unknown as { time: unknown }).time = api
  useMcpStore.setState({ open: true, list: [] })
  useProfileStore.setState({ active: PADRAO } as never)
})
afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('tela de MCPs', () => {
  it('lista os MCPs e explica a regra de escrita', async () => {
    const r = render(<McpsScreen />)
    await waitFor(() => expect(r.getByRole('button', { name: /linear/ })).toBeTruthy())
    fireEvent.click(r.getByRole('button', { name: /linear/ }))
    expect(r.getByText(/Escrita só nos agentes Claude/)).toBeTruthy()
    expect(r.getByText('get_issue')).toBeTruthy()
    expect(r.getByText('save_issue')).toBeTruthy()
  })
  it('trocar uma ferramenta de lado chama setMcpTool', async () => {
    const r = render(<McpsScreen />)
    await waitFor(() => r.getByRole('button', { name: /linear/ }))
    fireEvent.click(r.getByRole('button', { name: /linear/ }))
    fireEvent.click(r.getByRole('button', { name: 'Mover save_issue para leitura' }))
    expect(api.setMcpTool).toHaveBeenCalledWith({ id: 'm1', tool: 'save_issue', read: true })
  })
  it('importar do Claude Code mostra o que dá para trazer', async () => {
    const r = render(<McpsScreen />)
    fireEvent.click(r.getByRole('button', { name: 'Importar do Claude Code' }))
    await waitFor(() => r.getByRole('button', { name: 'Importar playwright' }))
    fireEvent.click(r.getByRole('button', { name: 'Importar playwright' }))
    await waitFor(() => expect(api.importMcp).toHaveBeenCalledWith('playwright'))
  })
  it('adicionar: separa o comando e manda o segredo só na entrada', async () => {
    const r = render(<McpsScreen />)
    fireEvent.click(r.getByRole('button', { name: 'Adicionar MCP' }))
    fireEvent.change(r.getByLabelText('Nome'), { target: { value: 'meu' } })
    fireEvent.change(r.getByLabelText('Comando'), { target: { value: 'npx -y @x/mcp' } })
    fireEvent.change(r.getByLabelText('Variáveis secretas'), { target: { value: 'TOKEN=abc' } })
    fireEvent.click(r.getByRole('button', { name: 'Salvar e testar' }))
    await waitFor(() => expect(api.saveMcp).toHaveBeenCalled())
    const arg = api.saveMcp.mock.calls[0][0] as { def: { transport: { command: string; args: string[] }; secretNames: string[]; mode: string }; secrets: Record<string, string> }
    expect(arg.def.transport).toEqual({ kind: 'stdio', command: 'npx', args: ['-y', '@x/mcp'] })
    expect(arg.def.mode).toBe('read')
    expect(arg.secrets).toEqual({ TOKEN: 'abc' })
  })
})
