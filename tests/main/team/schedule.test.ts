import { registerAgents } from '@shared/agents'
import { resolveAgentDefs } from '@shared/profiles'
import { describe, expect, it } from 'vitest'
import type { AgentId } from '@shared/agents'
import type { Lineup, TeamStep } from '@shared/team'
import { areasOverlap, buildWaves, isBig, normalizeAreas } from '../../../src/main/team/schedule'

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
  it('M-3: quem escreve não entra na onda em que o Lupa revisa', () => {
    expect(buildWaves([step('forja', ['server']), step('lupa'), step('pincel', ['web'])])).toEqual([[0], [1], [2]])
  })
})

describe('isBig', () => {
  it('Bússola marcou grande', () => expect(isBig(lineup([step('forja', ['a'])], true), false)).toBe(true))
  it('mais de 3 áreas', () => expect(isBig(lineup([step('forja', ['a', 'b']), step('pincel', ['c', 'd'])]), false)).toBe(true))
  it.each(['package.json', 'pnpm-lock.yaml', 'prisma/schema.prisma', 'db/migrations/001.sql', 'vite.config.ts', 'tsconfig.json', '.env.local', 'Dockerfile'])(
    'área estrutural %s', area => expect(isBig(lineup([step('forja', [area])]), false)).toBe(true))
  it('pequeno', () => expect(isBig(lineup([step('forja', ['server/health.js']), step('pincel', ['web'])]), false)).toBe(false))
  it('forçado', () => expect(isBig(lineup([step('forja', ['a'])]), true)).toBe(true))
})

describe('normalizeAreas (I-3)', () => {
  const cwd = '/Users/n/proj'
  it('caminho absoluto dentro do projeto vira relativo e se cruza com o relativo', () => {
    const a = normalizeAreas(['/Users/n/proj/src/api'], cwd), b = normalizeAreas(['src/api/x.ts'], cwd)
    expect(a).toEqual(['src/api'])
    expect(areasOverlap(a, b)).toBe(true)
  })
  it('.. e maiúsculas são normalizados', () => {
    expect(normalizeAreas(['src/a/../b', 'Src/Api'], cwd)).toEqual(['src/b', 'src/api'])
  })
  it('área fora do projeto ou vazia vira * (cruza com tudo)', () => {
    expect(normalizeAreas(['../fora'], cwd)).toEqual(['*'])
    expect(normalizeAreas(['/etc'], cwd)).toEqual(['*'])
    expect(normalizeAreas(['.'], cwd)).toEqual(['*'])
  })
})

describe('papéis do perfil', () => {
  it('quem "revisa o trabalho" no perfil entra depois de quem escreve', () => {
    registerAgents(resolveAgentDefs({
      id: 'sch', nome: 'S', builtin: false, defaults: { transport: { kind: 'cli', tool: 'claude' } },
      agents: [
        { id: 'w1', nome: 'W', prompt: '', funcao: '', readOnly: false, reviewer: false, consultable: false },
        { id: 'r1', nome: 'R', prompt: '', funcao: '', readOnly: true, reviewer: true, consultable: true },
      ],
    }))
    expect(buildWaves([{ agentId: 'w1', task: 'a', areas: ['web'] }, { agentId: 'r1', task: 'b', areas: [] }])).toEqual([[0], [1]])
  })
})

