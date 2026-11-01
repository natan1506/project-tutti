import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openStore } from '../../../src/main/store/db'

describe('store', () => {
  it('upsertProject não duplica e atualiza lastOpenedAt', async () => {
    const s = openStore(':memory:')
    const p1 = s.upsertProject('/x/meu-app')
    await new Promise(r => setTimeout(r, 5))
    const p2 = s.upsertProject('/x/meu-app')
    expect(p2.id).toBe(p1.id)
    expect(p2.name).toBe('meu-app')
    expect(p2.lastOpenedAt).toBeGreaterThan(p1.lastOpenedAt)
    expect(s.recentProjects()).toHaveLength(1)
  })

  it('recentProjects ordena pelo mais recente', async () => {
    const s = openStore(':memory:')
    s.upsertProject('/a'); await new Promise(r => setTimeout(r, 5)); s.upsertProject('/b')
    expect(s.recentProjects().map(p => p.path)).toEqual(['/b', '/a'])
  })

  it('guarda conversa, run e eventos em ordem', () => {
    const s = openStore(':memory:')
    const p = s.upsertProject('/a')
    const c = s.createConversation(p.id, 'Primeira')
    expect(s.listConversations(p.id).map(x => x.title)).toEqual(['Primeira'])
    const r = s.createRun({ id: 'r1', conversationId: c.id, agentId: 'forja', prompt: 'faz', startedAt: 1, hasCheckpoint: true })
    expect(r.status).toBe('running')
    s.appendEvent('r1', { type: 'text', text: 'um' })
    s.appendEvent('r1', { type: 'tool', name: 'Bash', summary: 'ls' })
    s.appendEvent('r1', { type: 'text', text: 'dois' })
    expect(s.listEvents('r1')).toEqual([
      { type: 'text', text: 'um' }, { type: 'tool', name: 'Bash', summary: 'ls' }, { type: 'text', text: 'dois' },
    ])
    s.finishRun('r1', 'done', 'sess-1')
    const [row] = s.listRuns(c.id)
    expect(row).toMatchObject({ id: 'r1', status: 'done', sessionId: 'sess-1', agentId: 'forja', hasCheckpoint: true })
    expect(row.finishedAt).toEqual(expect.any(Number))
  })

  it('marca como interrompido o run que ficou rodando quando o app fechou', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'db-')), 'time.db')
    const s1 = openStore(file)
    const p = s1.upsertProject('/a')
    const c = s1.createConversation(p.id, 't')
    s1.createRun({ id: 'r1', conversationId: c.id, agentId: 'forja', prompt: 'x', startedAt: 1, hasCheckpoint: true })
    s1.close()
    const s2 = openStore(file)
    expect(s2.markInterruptedRuns()).toBe(1)
    expect(s2.listRuns(c.id)[0]).toMatchObject({ status: 'interrupted', hasCheckpoint: true })
  })
  it('lastSessionFor devolve a sessão do pedido concluído mais recente daquele agente naquela conversa', () => {
    const s = openStore(':memory:')
    const p = s.upsertProject('/a')
    const c1 = s.createConversation(p.id, 'c1'), c2 = s.createConversation(p.id, 'c2')
    const run = (id: string, conv: string, agentId: 'forja' | 'pincel', status: 'done' | 'error' | 'cancelled', sid: string, at: number) => {
      s.createRun({ id, conversationId: conv, agentId, prompt: 'x', startedAt: at, hasCheckpoint: true })
      s.finishRun(id, status, sid)
    }
    run('r1', c1.id, 'forja', 'done', 's-velha', 1)
    run('r2', c1.id, 'forja', 'done', 's-nova', 2)
    run('r3', c1.id, 'forja', 'error', 's-erro', 3)
    run('r4', c1.id, 'forja', 'cancelled', 's-cancel', 4)
    run('r5', c1.id, 'pincel', 'done', 's-pincel', 5)
    run('r6', c2.id, 'forja', 'done', 's-outra-conversa', 6)
    expect(s.lastSessionFor(c1.id, 'forja')).toBe('s-nova')
    expect(s.lastSessionFor(c1.id, 'pincel')).toBe('s-pincel')
    expect(s.lastSessionFor(c2.id, 'pincel')).toBeNull()
  })
  it('guarda o pai dos runs-filhos e lista os filhos em ordem', () => {
    const s = openStore(':memory:')
    const p = s.upsertProject('/a')
    const c = s.createConversation(p.id, 't')
    s.createRun({ id: 'pai', conversationId: c.id, agentId: 'bussola', prompt: 'x', startedAt: 1, hasCheckpoint: true })
    s.createRun({ id: 'f2', conversationId: c.id, agentId: 'pincel', prompt: 'b', startedAt: 3, hasCheckpoint: false, parentRunId: 'pai' })
    s.createRun({ id: 'f1', conversationId: c.id, agentId: 'forja', prompt: 'a', startedAt: 2, hasCheckpoint: false, parentRunId: 'pai' })
    expect(s.getRun('f1')!.parentRunId).toBe('pai')
    expect(s.getRun('pai')!.parentRunId).toBeNull()
    expect(s.listChildren('pai').map(r => r.id)).toEqual(['f1', 'f2'])
  })
  it('grava e soma uso por ferramenta, run e dia; último limite por janela', () => {
    const s = openStore(':memory:')
    const p = s.upsertProject('/a')
    const c = s.createConversation(p.id, 't')
    s.createRun({ id: 'r1', conversationId: c.id, agentId: 'forja', prompt: 'x', startedAt: 1, hasCheckpoint: true })
    s.createRun({ id: 'r2', conversationId: c.id, agentId: 'radar', prompt: 'y', startedAt: 2, hasCheckpoint: true })
    s.recordUsage('r1', 'forja', 'claude', { input: 10, output: 5, cacheRead: 1, reasoning: 0 }, 100)
    s.recordUsage('r1', 'forja', 'claude', { input: 20, output: 5, cacheRead: 0, reasoning: 2 }, 200)
    s.recordUsage('r2', 'radar', 'gemini', { input: 7, output: 1, cacheRead: 0, reasoning: 0 }, 150)
    expect(s.tokensSince('claude', 150)).toEqual({ input: 20, output: 5, cacheRead: 0, reasoning: 2 })
    expect(s.tokensSince('claude', 0)).toEqual({ input: 30, output: 10, cacheRead: 1, reasoning: 2 })
    expect(s.tokensByRun(c.id)).toEqual([
      { runId: 'r1', agentId: 'forja', tool: 'claude', tokens: { input: 30, output: 10, cacheRead: 1, reasoning: 2 } },
      { runId: 'r2', agentId: 'radar', tool: 'gemini', tokens: { input: 7, output: 1, cacheRead: 0, reasoning: 0 } },
    ])
    expect(s.tokensByDay(7, 300).map(d => [d.projectPath, d.tool, d.tokens.input])).toEqual(expect.arrayContaining([['/a', 'claude', 30], ['/a', 'gemini', 7]]))
    s.recordLimit({ tool: 'claude', window: 'five_hour', utilization: 20, at: 1 })
    s.recordLimit({ tool: 'claude', window: 'five_hour', utilization: 30, resetsAt: 9, at: 2 })
    s.recordLimit({ tool: 'claude', window: 'seven_day', utilization: 80, at: 1 })
    expect(s.latestLimits()).toEqual(expect.arrayContaining([
      { tool: 'claude', window: 'five_hour', utilization: 30, resetsAt: 9, at: 2 },
      { tool: 'claude', window: 'seven_day', utilization: 80, at: 1 },
    ]))
    expect(s.latestLimits()).toHaveLength(2)
  })
})
