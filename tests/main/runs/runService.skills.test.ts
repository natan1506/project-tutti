import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { skillsInstructions, type SkillDraft } from '@shared/skills'
import type { AdapterRunOptions, AgentAdapter } from '../../../src/main/adapters/types'
import { runGit } from '../../../src/main/git/git'
import { openStore } from '../../../src/main/store/db'
import { RunService } from '../../../src/main/runs/runService'

const skill: SkillDraft = { name: 'resumo-3', description: 'Use em resumos.', body: 'Três tópicos.' }

async function setup(skills: SkillDraft[]) {
  const dir = mkdtempSync(join(tmpdir(), 'run-'))
  await runGit(dir, ['init', '-q'])
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  const calls: AdapterRunOptions[] = []
  const fake: AgentAdapter = { run: async function* (o) { calls.push(o); yield { type: 'done' } } }
  const store = openStore(':memory:')
  const conv = store.createConversation(store.upsertProject(dir).id, 't')
  const plugins = mkdtempSync(join(tmpdir(), 'plugins-'))
  const svc = new RunService({
    store, adapters: { claude: fake, codex: fake, gemini: fake, opencode: fake }, emit: () => {}, homeDir: mkdtempSync(join(tmpdir(), 'home-')),
    skillsFor: () => skills, skillPluginDir: id => join(plugins, id),
  })
  const go = async (agentId: string, mode?: 'consult') => svc.whenFinished(await svc.start({ projectPath: dir, conversationId: conv.id, agentId, prompt: 'faz', ...(mode ? { mode } : {}) }))
  return { calls, go, plugins }
}

describe('skills nos pedidos', () => {
  it('agente Claude CLI recebe o plugin, sem o bloco nas instruções', async () => {
    const { calls, go, plugins } = await setup([skill])
    await go('forja')
    expect(calls[0].skillPlugin).toEqual({ path: join(plugins, 'forja'), names: ['tutti:resumo-3'] })
    expect(calls[0].instructions).not.toContain('Três tópicos.')
  })

  it('agente de outra ferramenta recebe as skills nas instruções', async () => {
    const { calls, go } = await setup([skill])
    await go('lupa')
    expect(calls[0].skillPlugin).toBeUndefined()
    expect(calls[0].instructions.endsWith(skillsInstructions([skill]))).toBe(true)
  })

  it('passo em modo consulta não recebe skills', async () => {
    const { calls, go } = await setup([skill])
    await go('lupa', 'consult')
    expect(calls[0].skillPlugin).toBeUndefined()
    expect(calls[0].instructions).not.toContain('Três tópicos.')
  })

  it('sem skills, nada muda; agente removido segue sem lançar', async () => {
    const { calls, go } = await setup([])
    await go('forja')
    expect(calls[0].skillPlugin).toBeUndefined()
    expect(calls[0].instructions).not.toContain('Skills (')
  })
})
