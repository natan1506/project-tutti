import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toSkillMd, type SkillDraft } from '@shared/skills'

// Skills dos agentes Claude CLI como plugin local do Agent SDK (spike-skills.md): nada vai para ~/.claude nem para o projeto.

const PLUGIN = 'tutti'

export const skillQualifiedName = (name: string): string => `${PLUGIN}:${name}`

/** Regrava a pasta do plugin do agente só com as skills dadas (a que foi desmarcada some). */
export function writeClaudePlugin(dir: string, skills: SkillDraft[]): { path: string; names: string[] } {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ name: PLUGIN, version: '0.0.0', description: 'Skills criadas no Tutti' }))
  for (const s of skills) {
    mkdirSync(join(dir, 'skills', s.name), { recursive: true })
    writeFileSync(join(dir, 'skills', s.name, 'SKILL.md'), toSkillMd(s))
  }
  return { path: dir, names: skills.map(s => skillQualifiedName(s.name)) }
}
