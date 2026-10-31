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
})
