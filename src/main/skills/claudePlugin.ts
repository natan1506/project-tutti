import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toSkillMd, type SkillDraft } from '@shared/skills'

// Skills dos agentes Claude CLI como plugin local do Agent SDK (spike-skills.md): nada vai para ~/.claude nem para o projeto.

const PLUGIN = 'tutti'
/** Pasta de plugin sem uso há mais que isso é apagada (um pedido não dura um dia). */
const STALE_MS = 86_400_000

export const skillQualifiedName = (name: string): string => `${PLUGIN}:${name}`

/**
 * Plugin do agente numa pasta por conteúdo (`<base>/<hash>`): o mesmo agente pode estar rodando em outro projeto
 * com a versão anterior, então nada em uso é apagado nem reescrito.
 */
export function writeClaudePlugin(base: string, skills: SkillDraft[]): { path: string; names: string[] } {
  const files = skills.map(s => [s.name, toSkillMd(s)] as const)
  const hash = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16)
  const dir = join(base, hash)
  mkdirSync(base, { recursive: true })
  if (existsSync(dir)) {
    const now = new Date()
    utimesSync(dir, now, now)
  } else {
    const tmp = join(base, `.tmp-${randomUUID()}`)
    mkdirSync(join(tmp, '.claude-plugin'), { recursive: true })
    writeFileSync(join(tmp, '.claude-plugin/plugin.json'), JSON.stringify({ name: PLUGIN, version: '0.0.0', description: 'Skills criadas no Tutti' }))
    for (const [name, md] of files) {
      mkdirSync(join(tmp, 'skills', name), { recursive: true })
      writeFileSync(join(tmp, 'skills', name, 'SKILL.md'), md)
    }
    try {
      renameSync(tmp, dir)
    } catch (e) {
      // outro pedido gravou a mesma versão ao mesmo tempo
      rmSync(tmp, { recursive: true, force: true })
      if (!existsSync(dir)) throw e
    }
  }
  for (const entry of readdirSync(base)) {
    const p = join(base, entry)
    if (entry !== hash && Date.now() - statSync(p).mtimeMs > STALE_MS) rmSync(p, { recursive: true, force: true })
  }
  return { path: dir, names: files.map(([name]) => skillQualifiedName(name)) }
}
