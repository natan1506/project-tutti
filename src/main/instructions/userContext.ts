import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SkillDraft } from '@shared/skills'

// O que o Natan já ensinou ao Claude Code e o Tutti aproveita: memórias do projeto, skills de ~/.claude/skills e
// o MCP do Linear (só leitura, só para o cérebro). Plugins, hooks e permissões do Claude Code continuam de fora.

const MEMORY_MAX = 24_000

/** Pasta do projeto em ~/.claude/projects: o caminho com "-" no lugar do que não é letra ou número. */
export const claudeProjectSlug = (projectDir: string): string => projectDir.replace(/[^a-zA-Z0-9-]/g, '-')

const read = (file: string): string => { try { return readFileSync(file, 'utf8') } catch { return '' } }

/** MEMORY.md do projeto e as memórias que ele lista (na ordem do índice), até ~24 mil caracteres. */
export function loadProjectMemory(projectDir: string, homeDir = homedir()): string {
  const dir = join(homeDir, '.claude', 'projects', claudeProjectSlug(projectDir), 'memory')
  const index = read(join(dir, 'MEMORY.md')).trim()
  if (!index) return ''
  const linked = [...index.matchAll(/\]\(([^)\s/]+\.md)\)/g)].map(m => m[1]).filter((f, i, all) => all.indexOf(f) === i && f !== 'MEMORY.md')
  const parts = [index, ...linked.map(f => read(join(dir, f)).trim()).filter(Boolean)]
  const text = parts.join('\n\n---\n\n')
  return text.length > MEMORY_MAX ? `${text.slice(0, MEMORY_MAX)}\n[…memória cortada]` : text
}

export type UserSkill = SkillDraft & { dir: string }

/**
 * SKILL.md do Natan, mais tolerante que o das skills criadas no Tutti: sem cabeçalho, o nome é o da pasta e a
 * descrição é o primeiro título; descrição e corpo longos valem (o corpo é cortado só acima de 40 mil caracteres).
 */
function userSkill(folder: string, text: string): SkillDraft | null {
  const md = text.replace(/\r\n/g, '\n').trim()
  if (!md) return null
  const fm = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const field = (k: string) => fm?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["'](.*)["']$/, '$1')
  const body = (fm ? fm[2] : md).trim().slice(0, 40_000)
  const name = field('name') || folder
  const description = field('description') || body.split('\n').find(l => l.trim())!.replace(/^#+\s*/, '').trim().slice(0, 1024)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || !body) return null
  return { name, description, body }
}

/** Skills de ~/.claude/skills/<nome>/SKILL.md, com a pasta (template, exemplos e scripts vão junto). */
export function loadUserSkills(homeDir = homedir()): UserSkill[] {
  const base = join(homeDir, '.claude', 'skills')
  if (!existsSync(base)) return []
  const out: UserSkill[] = []
  for (const name of readdirSync(base).sort()) {
    const dir = join(base, name)
    const parsed = userSkill(name, read(join(dir, 'SKILL.md')))
    if (parsed) out.push({ ...parsed, dir })
  }
  return out
}

/** Servidores MCP do Claude Code (~/.claude.json) que o Tutti usa, pelo nome; os outros ficam de fora. */
export function userMcpServers(homeDir: string, names: string[]): Record<string, Record<string, unknown>> {
  let all: Record<string, Record<string, unknown>> = {}
  try { all = (JSON.parse(read(join(homeDir, '.claude.json')) || '{}').mcpServers ?? {}) as typeof all } catch { /* arquivo estranho: nenhum */ }
  return Object.fromEntries(names.filter(n => all[n] && typeof all[n] === 'object').map(n => [n, all[n]]))
}

/** Ferramentas do Linear que só leem (o cérebro lê o card; nunca cria, edita ou apaga nada lá). */
export function linearReadOnly(toolName: string): boolean {
  const m = toolName.match(/^mcp__linear__(.+)$/)
  return !!m && /^(get|list|search|extract)_/.test(m[1])
}
