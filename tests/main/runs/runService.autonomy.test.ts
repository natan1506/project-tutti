import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AutonomyLevel } from '@shared/autonomy'
import type { RunEvent } from '@shared/events'
import type { AdapterRunOptions, AgentAdapter } from '../../../src/main/adapters/types'
import { runGit } from '../../../src/main/git/git'
import { openStore } from '../../../src/main/store/db'
import { RunService } from '../../../src/main/runs/runService'

async function setup(levels: { current: AutonomyLevel }, sandboxAvailable = true) {
  const dir = mkdtempSync(join(tmpdir(), 'run-'))
  await runGit(dir, ['init', '-q'])
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  const calls: AdapterRunOptions[] = []
  const seen: AutonomyLevel[] = []
  const fake: AgentAdapter = { run: async function* (o) { calls.push(o); seen.push(o.autonomy?.() ?? 'accept_edits'); levels.current = 'ask_all'; seen.push(o.autonomy?.() ?? 'accept_edits'); yield { type: 'done' } } }
  const store = openStore(':memory:')
  const conv = store.createConversation(store.upsertProject(dir).id, 't')
  const emitted: RunEvent[] = []
  const svc = new RunService({
    store, adapters: { claude: fake, codex: fake, gemini: fake, opencode: fake }, emit: (_id, ev) => emitted.push(ev), homeDir: mkdtempSync(join(tmpdir(), 'home-')),
    autonomyFor: p => (p === dir ? levels.current : 'accept_edits'), sandboxAvailable: () => sandboxAvailable,
  })
  const go = async (agentId: string, mode?: 'consult') => svc.whenFinished(await svc.start({ projectPath: dir, conversationId: conv.id, agentId, prompt: 'faz', ...(mode ? { mode } : {}) }))
  return { calls, seen, go, emitted }
}

describe('autonomia nos pedidos', () => {
  it('Sozinho: agente Claude CLI roda com sandbox; opencode não', async () => {
    const levels = { current: 'autonomous' as AutonomyLevel }
    const { calls, go } = await setup(levels)
    await go('forja')
    levels.current = 'autonomous'
    await go('curinga')
    expect(calls[0].sandbox).toBe(true)
    expect(calls[1].sandbox).toBeFalsy()
  })

  it('o nível é lido na hora: mudança no meio do pedido já vale', async () => {
    const levels = { current: 'autonomous' as AutonomyLevel }
    const { seen, go } = await setup(levels)
    await go('forja')
    expect(seen).toEqual(['autonomous', 'ask_all'])
  })

  it('consulta e outros níveis: sem sandbox', async () => {
    const levels = { current: 'accept_edits' as AutonomyLevel }
    const { calls, go } = await setup(levels)
    await go('forja')
    levels.current = 'autonomous'
    await go('lupa', 'consult')
    expect(calls.map(c => c.sandbox ?? false)).toEqual([false, false])
  })

  it('sem sandbox disponível: avisa e segue sem sandbox', async () => {
    const levels = { current: 'autonomous' as AutonomyLevel }
    const { calls, go, emitted } = await setup(levels, false)
    await go('forja')
    expect(calls[0].sandbox).toBeFalsy()
    expect(emitted).toContainEqual({ type: 'notice', text: 'Sozinho indisponível: usando Aceitar edições.' })
  })
})
