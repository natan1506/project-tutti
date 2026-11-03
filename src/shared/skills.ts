import { z } from 'zod'

// Skill criada no Tutti (plano skills, Design §1): um SKILL.md só de texto, marcada para alguns agentes.

export interface Skill {
  id: string
  /** kebab-case, único entre as skills. */
  name: string
  /** Quando usar: é o que o agente lê para decidir se a skill vale para a tarefa. */
  description: string
  body: string
  agentIds: string[]
  updatedAt: number
}

export type SkillDraft = Pick<Skill, 'name' | 'description' | 'body'>

export const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const NAME_MAX = 64
const DESCRIPTION_MAX = 300
export const BODY_MAX = 20_000

export function toSkillMd(d: SkillDraft): string {
  return `---\nname: ${d.name}\ndescription: ${d.description.replace(/\s+/g, ' ').trim()}\n---\n\n${d.body.trim()}\n`
}

/** Lê um SKILL.md puro ou o primeiro bloco ```skill de uma resposta; `null` se não for uma skill válida. */
export function parseSkillMd(text: string): SkillDraft | null {
  const block = text.match(/```skill[^\n]*\n([\s\S]*?)\n```/)
  const md = (block ? block[1] : text).trim()
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return null
  const field = (k: string) => m[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^(["'])(.*)\1$/, '$2')
  const name = field('name')
  const description = field('description')
  const body = m[2].trim()
  if (!name || !SKILL_NAME_RE.test(name) || name.length > NAME_MAX || !description || !body) return null
  return { name, description, body }
}

const skillSchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), body: z.string(),
  agentIds: z.array(z.string()), updatedAt: z.number(),
})

export function validateSkill(raw: unknown, others: Skill[]): { ok: true; skill: Skill } | { ok: false; errors: string[] } {
  const parsed = skillSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: ['Skill inválida.'] }
  const s = parsed.data
  const errors: string[] = []
  if (!SKILL_NAME_RE.test(s.name) || s.name.length > NAME_MAX) errors.push(`Nome em letras minúsculas, números e hífens (até ${NAME_MAX}).`)
  if (others.some(o => o.id !== s.id && o.name === s.name)) errors.push(`Já existe uma skill chamada "${s.name}".`)
  if (!s.description.trim()) errors.push('Diga quando a skill deve ser usada.')
  if (s.description.length > DESCRIPTION_MAX) errors.push(`O "quando usar" tem no máximo ${DESCRIPTION_MAX} caracteres.`)
  if (!s.body.trim()) errors.push('A skill precisa de instruções.')
  if (s.body.length > BODY_MAX) errors.push(`As instruções têm no máximo ${BODY_MAX.toLocaleString('pt-BR')} caracteres.`)
  return errors.length ? { ok: false, errors } : { ok: true, skill: s }
}

/** Bloco das instruções para agentes que não carregam skills por plugin (Design §6). */
export function skillsInstructions(skills: SkillDraft[]): string {
  if (!skills.length) return ''
  return [
    'Skills (siga a skill quando a tarefa combinar com o "quando usar"):',
    ...skills.map(s => `## ${s.name}\nQuando usar: ${s.description}\n\n${s.body.trim()}`),
  ].join('\n\n')
}
