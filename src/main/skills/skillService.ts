import { randomUUID } from 'node:crypto'
import type { AgentId } from '@shared/agents'
import { parseSkillMd, skillsInstructions, validateSkill, type Skill, type SkillDraft } from '@shared/skills'
import type { Store } from '../store/db'
import { createPrompt, improvePrompt } from './prompts'

export interface ConsultInput { usageRunId: string; agentId: AgentId; prompt: string; cwd: string; instructions?: string; signal: AbortSignal; timeoutMs?: number }

interface Deps {
  store: Pick<Store, 'listSkills' | 'saveSkill' | 'deleteSkill'>
  runs: { consultOnce(i: ConsultInput): Promise<string> }
  /** Pasta vazia do app onde quem cria a skill roda (não lê o projeto do Natan). */
  workDir: string
  /** Agente por API paga: só roda com o clique do Natan (`confirmPaid`). */
  isPaid(agentId: AgentId): boolean
}

interface RunBase { draftId: string; confirmPaid?: boolean; signal: AbortSignal }

const TIMEOUT = 300_000

/** Skills criadas no Tutti: criar, testar e ajustar por consulta (só leitura), e quais valem para cada agente. */
export class SkillService {
  constructor(private deps: Deps) {}

  all(): Skill[] {
    return this.deps.store.listSkills()
  }

  save(s: Skill): Skill {
    const skill = { ...s, id: s.id || `sk_${randomUUID()}`, updatedAt: Date.now() }
    const v = validateSkill(skill, this.all())
    if (!v.ok) throw new Error(v.errors.join(' '))
    this.deps.store.saveSkill(v.skill)
    return v.skill
  }

  remove(id: string): void {
    this.deps.store.deleteSkill(id)
  }

  skillsFor(agentId: AgentId): SkillDraft[] {
    return this.all().filter(s => s.agentIds.includes(agentId)).map(({ name, description, body }) => ({ name, description, body }))
  }

  async create(i: RunBase & { request: string; creatorId: AgentId }): Promise<SkillDraft> {
    return this.draft(await this.consult(i, i.creatorId, createPrompt(i.request), this.deps.workDir))
  }

  async test(i: RunBase & { skill: SkillDraft; agentId: AgentId; task: string; cwd?: string }): Promise<string> {
    return this.consult(i, i.agentId, i.task, i.cwd ?? this.deps.workDir, skillsInstructions([i.skill]))
  }

  async improve(i: RunBase & { skill: SkillDraft; creatorId: AgentId; task: string; answer: string; feedback?: string }): Promise<SkillDraft> {
    return this.draft(await this.consult(i, i.creatorId, improvePrompt(i), this.deps.workDir))
  }

  private consult(i: RunBase, agentId: AgentId, prompt: string, cwd: string, instructions?: string): Promise<string> {
    if (this.deps.isPaid(agentId) && !i.confirmPaid) return Promise.reject(new Error('PAID_NEEDS_CONFIRM'))
    return this.deps.runs.consultOnce({
      usageRunId: `skill:${i.draftId}`, agentId, prompt, cwd, signal: i.signal, timeoutMs: TIMEOUT, ...(instructions ? { instructions } : {}),
    })
  }

  private draft(answer: string): SkillDraft {
    if (!answer.trim()) throw new Error('EMPTY_ANSWER')
    const d = parseSkillMd(answer)
    if (!d) throw new Error('INVALID_SKILL')
    return d
  }
}
