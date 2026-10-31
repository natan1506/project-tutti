import { describe, expect, it } from 'vitest'
import type { AgentId } from '@shared/agents'
import type { Lineup, TeamStep } from '@shared/team'
import { areasOverlap, buildWaves, isBig } from '../../../src/main/team/schedule'

const step = (agentId: AgentId, areas: string[] = []): TeamStep => ({ agentId, task: 't', areas })
const lineup = (steps: TeamStep[], big = false): Lineup => ({ steps, big, summary: '' })

describe('areasOverlap', () => {
  it.each([
    [['server'], ['web'], false],
    [['src/a'], ['src'], true],
    [[], ['x'], true],
    [['*'], ['x'], true],
    [['src/app.ts'], ['src/app.tsx'], false],
    [['web/a.html'], ['web/a.html'], true],
  ])('%j × %j → %s', (a, b, want) => expect(areasOverlap(a as string[], b as string[])).toBe(want))
})

describe('buildWaves', () => {
  it('escritores com áreas disjuntas trabalham juntos', () => {
    expect(buildWaves([step('forja', ['server']), step('pincel', ['web'])])).toEqual([[0, 1]])
  })
  it('áreas que se cruzam vão em sequência', () => {
    expect(buildWaves([step('forja', ['src']), step('pincel', ['src/ui'])])).toEqual([[0], [1]])
  })
  it('escritor sem área declarada vai em sequência', () => {
    expect(buildWaves([step('forja', ['server']), step('pincel')])).toEqual([[0], [1]])
  })
  it('só-leitura roda junto com quem escreve', () => {
    expect(buildWaves([step('radar'), step('forja', ['server'])])).toEqual([[0, 1]])
  })
  it('revisão do Lupa vem depois de quem escreveu antes dela', () => {
    expect(buildWaves([step('forja', ['server']), step('pincel', ['web']), step('lupa')])).toEqual([[0, 1], [2]])
  })
  it('o mesmo agente nunca roda duas vezes na mesma onda', () => {
    expect(buildWaves([step('forja', ['a']), step('forja', ['b'])])).toEqual([[0], [1]])
  })
  it('sem passos, sem ondas', () => expect(buildWaves([])).toEqual([]))
})

describe('isBig', () => {
  it('Bússola marcou grande', () => expect(isBig(lineup([step('forja', ['a'])], true), false)).toBe(true))
  it('mais de 3 áreas', () => expect(isBig(lineup([step('forja', ['a', 'b']), step('pincel', ['c', 'd'])]), false)).toBe(true))
  it.each(['package.json', 'pnpm-lock.yaml', 'prisma/schema.prisma', 'db/migrations/001.sql', 'vite.config.ts', 'tsconfig.json', '.env.local', 'Dockerfile'])(
    'área estrutural %s', area => expect(isBig(lineup([step('forja', [area])]), false)).toBe(true))
  it('pequeno', () => expect(isBig(lineup([step('forja', ['server/health.js']), step('pincel', ['web'])]), false)).toBe(false))
  it('forçado', () => expect(isBig(lineup([step('forja', ['a'])]), true)).toBe(true))
})
