import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Só as instruções do Natan entram nos agentes — nada de plugins, skills, hooks ou MCP (spec §7).

export async function loadInstructions(projectDir: string, homeDir = homedir()): Promise<string> {
  const sources: [string, string][] = [
    ['Instruções globais (CLAUDE.md)', join(homeDir, '.claude', 'CLAUDE.md')],
    ['Instruções globais (Codex AGENTS.md)', join(homeDir, '.codex', 'AGENTS.md')],
    ['Instruções do projeto (CLAUDE.md)', join(projectDir, 'CLAUDE.md')],
    ['Instruções do projeto (AGENTS.md)', join(projectDir, 'AGENTS.md')],
  ]
  const parts: string[] = []
  for (const [title, file] of sources) {
    const text = (await readOptional(file)).trim()
    if (text) parts.push(`## ${title}\n\n${text}`)
  }
  return parts.join('\n\n')
}

async function readOptional(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw e
  }
}
