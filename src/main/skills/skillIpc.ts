import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { knownAgent } from '@shared/agents'
import { validateSkill, type Skill } from '@shared/skills'
import type { SkillRunError } from '@shared/models'
import type { SkillService } from './skillService'

// Handlers das skills (plano skills, Task 5), separados do ipc.ts para serem testáveis sem Electron.

const agent = z.string().refine(knownAgent, 'Agente inválido')
const draft = z.object({ name: z.string().max(64), description: z.string().max(300), body: z.string().max(20_000) })
const base = { draftId: z.string().min(1).max(100), confirmPaid: z.boolean().optional() }
const createInput = z.object({ ...base, request: z.string().min(1).max(5000), creatorId: agent })
const testInput = z.object({ ...base, skill: draft, agentId: agent, task: z.string().min(1).max(5000), projectPath: z.string().refine(isAbsolute).optional() })
const improveInput = z.object({ ...base, skill: draft, creatorId: agent, task: z.string().max(5000), answer: z.string().max(100_000), feedback: z.string().max(5000).optional() })

const KNOWN: SkillRunError[] = ['PAID_NEEDS_CONFIRM', 'INVALID_SKILL', 'AGENT_UNAVAILABLE', 'CANCELED', 'TIMEOUT', 'EMPTY_ANSWER', 'AGENT_ERROR']

export function skillHandlers(svc: SkillService) {
  const running = new Map<string, AbortController>()
  // Uma execução por rascunho; o sinal fica guardado para o cancelSkill (fechar a janela).
  async function run<T>(draftId: string, fn: (signal: AbortSignal) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: SkillRunError }> {
    running.get(draftId)?.abort()
    const ctl = new AbortController()
    running.set(draftId, ctl)
    try {
      return { ok: true, value: await fn(ctl.signal) }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      return { ok: false, error: ctl.signal.aborted ? 'CANCELED' : KNOWN.find(k => k === msg) ?? 'FAILED' }
    } finally {
      if (running.get(draftId) === ctl) running.delete(draftId)
    }
  }

  return {
    skills: (): Skill[] => svc.all(),
    saveSkill(raw: unknown): { ok: true; skill: Skill } | { ok: false; errors: string[] } {
      const v = validateSkill(raw, svc.all())
      return v.ok ? { ok: true, skill: svc.save(v.skill) } : v
    },
    deleteSkill: (id: unknown) => svc.remove(z.string().parse(id)),
    async createSkill(raw: unknown) {
      const i = createInput.parse(raw)
      const r = await run(i.draftId, signal => svc.create({ ...i, signal }))
      return r.ok ? { ok: true as const, skill: r.value } : r
    },
    async testSkill(raw: unknown) {
      const { projectPath, ...i } = testInput.parse(raw)
      const r = await run(i.draftId, signal => svc.test({ ...i, signal, ...(projectPath ? { cwd: projectPath } : {}) }))
      return r.ok ? { ok: true as const, answer: r.value } : r
    },
    async improveSkill(raw: unknown) {
      const i = improveInput.parse(raw)
      const r = await run(i.draftId, signal => svc.improve({ ...i, signal }))
      return r.ok ? { ok: true as const, skill: r.value } : r
    },
    cancelSkill: (draftId: unknown) => { running.get(z.string().parse(draftId))?.abort() },
    /** Parar tudo: cancela toda execução de skill em andamento. */
    cancelAllSkills: () => { for (const c of running.values()) c.abort() },
  }
}
