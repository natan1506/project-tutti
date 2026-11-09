import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeProjectSlug, linearReadOnly, loadProjectMemory, loadUserSkills, userMcpServers } from '../../../src/main/instructions/userContext'

const home = () => mkdtempSync(join(tmpdir(), 'home-'))

describe('memória do projeto (Claude Code)', () => {
  it('a pasta do Claude Code usa o caminho com "-" no lugar de "/" e "."', () => {
    expect(claudeProjectSlug('/Users/n/www/meu.app')).toBe('-Users-n-www-meu-app')
  })
  it('lê o MEMORY.md e as memórias que ele lista, nessa ordem', () => {
    const h = home()
    const dir = join(h, '.claude', 'projects', claudeProjectSlug('/repo/x'), 'memory')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'MEMORY.md'), '- [Regra](regra.md) — sempre pnpm\n- [Sumiu](nao-existe.md) — x\n')
    writeFileSync(join(dir, 'regra.md'), '---\nname: regra\n---\nUse pnpm, nunca npm.')
    writeFileSync(join(dir, 'solta.md'), 'não listada')
    const m = loadProjectMemory('/repo/x', h)
    expect(m).toContain('sempre pnpm')
    expect(m).toContain('Use pnpm, nunca npm.')
    expect(m).not.toContain('não listada')
  })
  it('sem memória, vazio; memória enorme é cortada', () => {
    const h = home()
    expect(loadProjectMemory('/repo/y', h)).toBe('')
    const dir = join(h, '.claude', 'projects', claudeProjectSlug('/repo/z'), 'memory')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'MEMORY.md'), 'x'.repeat(100_000))
    expect(loadProjectMemory('/repo/z', h).length).toBeLessThanOrEqual(24_100)
  })
})

describe('skills do Claude Code', () => {
  it('lê ~/.claude/skills/*/SKILL.md com nome, descrição e a pasta (para os arquivos extras)', () => {
    const h = home()
    const d = join(h, '.claude', 'skills', 'entregar-card')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'SKILL.md'), '---\nname: entregar-card\ndescription: Use ao entregar um card do Linear\n---\nPasso 1: leia o card.')
    writeFileSync(join(d, 'template.md'), 'modelo')
    mkdirSync(join(h, '.claude', 'skills', 'synced', 'abc'), { recursive: true })
    const s = loadUserSkills(h)
    expect(s).toEqual([{ name: 'entregar-card', description: 'Use ao entregar um card do Linear', body: 'Passo 1: leia o card.', dir: d }])
  })
  it('aceita skill sem cabeçalho (nome da pasta, descrição do título) e descrição longa', () => {
    const h = home()
    const a = join(h, '.claude', 'skills', 'db-query-analyzer')
    mkdirSync(a, { recursive: true })
    writeFileSync(join(a, 'SKILL.md'), '# Analisador de consultas\n\nRode EXPLAIN antes de mexer.')
    const b = join(h, '.claude', 'skills', 'longa')
    mkdirSync(b, { recursive: true })
    writeFileSync(join(b, 'SKILL.md'), `---\nname: longa\ndescription: ${'d'.repeat(420)}\n---\n${'c'.repeat(19_000)}`)
    const s = loadUserSkills(h)
    expect(s.map(x => x.name)).toEqual(['db-query-analyzer', 'longa'])
    expect(s[0]).toMatchObject({ description: 'Analisador de consultas', body: '# Analisador de consultas\n\nRode EXPLAIN antes de mexer.' })
    expect(s[1].description).toHaveLength(420)
    expect(s[1].body).toHaveLength(19_000)
  })

  it('sem pasta de skills, nenhuma', () => {
    expect(loadUserSkills(home())).toEqual([])
  })
})

describe('MCP do Claude Code', () => {
  it('pega só os servidores pedidos do ~/.claude.json', () => {
    const h = home()
    writeFileSync(join(h, '.claude.json'), JSON.stringify({ mcpServers: { linear: { type: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'] }, outro: { command: 'x' } } }))
    expect(userMcpServers(h, ['linear'])).toEqual({ linear: { type: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'] } })
    expect(userMcpServers(home(), ['linear'])).toEqual({})
  })
  it('Linear só leitura: get/list/search/extract sim; criar, salvar e apagar não', () => {
    for (const t of ['mcp__linear__get_issue', 'mcp__linear__list_comments', 'mcp__linear__extract_images', 'mcp__linear__search_documentation']) expect(linearReadOnly(t)).toBe(true)
    for (const t of ['mcp__linear__save_issue', 'mcp__linear__save_comment', 'mcp__linear__delete_comment', 'mcp__linear__create_attachment', 'Bash', 'mcp__outro__get_x']) expect(linearReadOnly(t)).toBe(false)
  })
})
