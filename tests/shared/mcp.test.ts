import { describe, expect, it } from 'vitest'
import { isReadTool, readToolNames, validateMcp, type McpServerDef } from '@shared/mcp'

const linear: McpServerDef = {
  id: 'm1', nome: 'linear', transport: { kind: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'] },
  secretNames: [], mode: 'read', agents: 'all', enabled: true, tools: [{ name: 'get_issue', read: true }, { name: 'save_issue', read: false }],
}

describe('regra de leitura', () => {
  it('nomes de leitura em snake e camelCase', () => {
    for (const n of ['get_issue', 'listComments', 'search_documentation', 'read_file', 'fetchPage', 'find_by_name', 'query_db', 'describe_table', 'view_x', 'show_y', 'extract_images', 'browser_snapshot', 'browser_take_screenshot']) expect(isReadTool(n), n).toBe(true)
  })
  it('o resto é escrita', () => {
    for (const n of ['save_issue', 'browser_navigate', 'deleteX', 'create_comment', 'run', 'getaway']) expect(isReadTool(n), n).toBe(false)
  })
  it('anotações do MCP mandam: destrutiva é escrita, readOnlyHint é leitura', () => {
    expect(isReadTool('get_x', { destructiveHint: true })).toBe(false)
    expect(isReadTool('run', { readOnlyHint: true })).toBe(true)
  })
  it('readToolNames devolve só as marcadas como leitura', () => {
    expect(readToolNames(linear)).toEqual(['get_issue'])
  })
})

describe('validação', () => {
  it('aceita o Linear do Claude Code', () => {
    expect(validateMcp(linear, []).ok).toBe(true)
  })
  it('recusa nome inválido, nome repetido e comando vazio', () => {
    expect(validateMcp({ ...linear, nome: 'meu mcp' }, [])).toMatchObject({ ok: false })
    expect(validateMcp({ ...linear, id: 'm2' }, [linear])).toEqual({ ok: false, errors: ['Já existe um MCP chamado "linear".'] })
    expect(validateMcp({ ...linear, transport: { kind: 'stdio', command: ' ', args: [] } }, [])).toMatchObject({ ok: false })
  })
  it('URL precisa ser http(s)', () => {
    expect(validateMcp({ ...linear, transport: { kind: 'http', url: 'ftp://x' } }, [])).toMatchObject({ ok: false })
    expect(validateMcp({ ...linear, transport: { kind: 'http', url: 'https://mcp.x.com/mcp' } }, []).ok).toBe(true)
  })
})

import { parseSecretLines } from '@shared/mcp'
describe('revisão: segredos e nomes', () => {
  it('linha sem "=" é recusada, sem virar nome de variável', () => {
    expect(parseSecretLines('ghp_abc123XYZ')).toEqual({ ok: false, error: 'Cada linha precisa ser NOME=valor (ex.: GITHUB_TOKEN=ghp_…).' })
    expect(parseSecretLines('TOKEN = abc \n\nOUTRO=x=y')).toEqual({ ok: true, secrets: { TOKEN: 'abc', OUTRO: 'x=y' } })
  })
  it('nomes reservados do Tutti são recusados', () => {
    for (const nome of ['tutti', 'navegador']) expect(validateMcp({ ...linear, nome }, [])).toMatchObject({ ok: false })
  })
})
