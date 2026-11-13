import { describe, expect, it } from 'vitest'
import type { AgentId, ToolKind } from '@shared/agents'
import { extractJson, parseConfirmation, parseLineup, parseTriage } from '../../../src/main/team/parse'

const ALL: AgentId[] = ['bussola', 'forja', 'pincel', 'radar', 'lupa', 'curinga']
const MODELS: Record<ToolKind, string[]> = { claude: ['claude-sonnet-5-5', 'claude-haiku-5-5'], codex: [], gemini: [], opencode: ['opencode/big-pickle'] }

describe('extractJson', () => {
  it('lê bloco ```json', () => expect(extractJson('Aqui:\n```json\n{"a":1}\n```')).toEqual({ a: 1 }))
  it('lê o primeiro objeto com chaves balanceadas no meio do texto', () => expect(extractJson('texto {"a":{"b":2}} fim')).toEqual({ a: { b: 2 } }))
  it('JSON quebrado devolve null', () => expect(extractJson('{"a": ')).toBeNull())
  it('sem JSON devolve null', () => expect(extractJson('nada aqui')).toBeNull())
})

describe('parseTriage', () => {
  it('normaliza notas, frases e candidatos', () => {
    const t = parseTriage({
      scores: [
        { agentId: 'forja', score: 93.7, line: 'Endpoint é back-end. Comigo.' },
        { agentId: 'pincel', score: 150, line: 'x'.repeat(100) },
        { agentId: 'zeus', score: 99, line: 'não existo' },
      ],
      candidates: ['forja', 'pincel', 'forja', 'zeus'], big: false,
    }, ALL)!
    expect(t.scores.find(s => s.agentId === 'forja')).toEqual({ agentId: 'forja', score: 94, line: 'Endpoint é back-end. Comigo.' })
    expect(t.scores.find(s => s.agentId === 'pincel')!.score).toBe(100)
    expect(t.scores.find(s => s.agentId === 'pincel')!.line).toHaveLength(80)
    expect(t.scores.some(s => (s.agentId as string) === 'zeus')).toBe(false)
    expect(t.scores.find(s => s.agentId === 'lupa')).toEqual({ agentId: 'lupa', score: 0, line: '' })
    expect(t.scores).toHaveLength(6)
    expect(t.candidates).toEqual(['forja', 'pincel'])
  })

  it('no máximo 3 candidatos, só disponíveis', () => {
    const t = parseTriage({ scores: [{ agentId: 'forja', score: 50, line: '' }], candidates: ['forja', 'pincel', 'lupa', 'radar'], big: true }, ['forja', 'pincel', 'lupa'])!
    expect(t.candidates).toEqual(['forja', 'pincel', 'lupa'])
    expect(t.big).toBe(true)
  })

  it('sem candidatos válidos, pega os 2 de maior nota (≥ 40)', () => {
    const t = parseTriage({ scores: [{ agentId: 'forja', score: 80, line: '' }, { agentId: 'pincel', score: 60, line: '' }, { agentId: 'lupa', score: 30, line: '' }], candidates: [], big: false }, ALL)!
    expect(t.candidates).toEqual(['forja', 'pincel'])
  })

  it('lixo devolve null', () => {
    expect(parseTriage(null, ALL)).toBeNull()
    expect(parseTriage({ scores: [{ agentId: 'zeus', score: 1, line: '' }], candidates: [], big: false }, ALL)).toBeNull()
    expect(parseTriage('texto', ALL)).toBeNull()
  })
})

describe('parseConfirmation', () => {
  it('aceita JSON', () => {
    expect(parseConfirmation('forja', '{"decision":"assumo_com_ajuda","line":"Preciso do Radar","helper":"radar"}'))
      .toEqual({ agentId: 'forja', decision: 'assumo_com_ajuda', line: 'Preciso do Radar', helper: 'radar' })
  })
  it('aceita texto livre', () => {
    expect(parseConfirmation('pincel', 'Assumo, a tela é minha.')).toEqual({ agentId: 'pincel', decision: 'assumo', line: 'Assumo, a tela é minha.' })
    expect(parseConfirmation('lupa', 'Isso não é comigo, é do Forja.').decision).toBe('nao_e_comigo')
    expect(parseConfirmation('lupa', 'hmm').decision).toBe('sem_resposta')
  })
  it('decisão inválida no JSON vira sem_resposta; helper desconhecido some', () => {
    expect(parseConfirmation('forja', '{"decision":"talvez","line":"x","helper":"zeus"}')).toEqual({ agentId: 'forja', decision: 'sem_resposta', line: 'x' })
  })
})

describe('parseLineup', () => {
  const raw = {
    summary: 'Forja faz o endpoint, Pincel a página.',
    big: false,
    steps: [
      { agentId: 'forja', task: 'Criar GET /health', model: 'claude-haiku-5-5', areas: ['./server/', 'server'] },
      { agentId: 'pincel', task: 'Página de status', model: 'gpt-99', areas: ['web/status.html'] },
      { agentId: 'zeus', task: 'x', areas: [] },
      { agentId: 'lupa', task: '', areas: [] },
    ],
  }
  it('normaliza passos, áreas e modelos', () => {
    const l = parseLineup(raw, ALL, MODELS)!
    expect(l.summary).toBe('Forja faz o endpoint, Pincel a página.')
    expect(l.steps).toEqual([
      { agentId: 'forja', task: 'Criar GET /health', model: 'claude-haiku-5-5', areas: ['server'] },
      { agentId: 'pincel', task: 'Página de status', areas: ['web/status.html'] },
    ])
  })
  it('escalação vazia ou só com agentes indisponíveis devolve null', () => {
    expect(parseLineup({ summary: '', big: false, steps: [] }, ALL, MODELS)).toBeNull()
    expect(parseLineup(raw, ['radar'], MODELS)).toBeNull()
    expect(parseLineup(undefined, ALL, MODELS)).toBeNull()
  })
})

describe('plano da esteira', () => {
  it('consulta vem como booleano; texto ou ausente vira mudança', async () => {
    const { parseEsteiraPlan } = await import('../../../src/main/team/parse')
    expect(parseEsteiraPlan({ tarefa: 't', pronto: 'p', consulta: true })).toEqual({ tarefa: 't', pronto: 'p', consulta: true })
    expect(parseEsteiraPlan({ tarefa: 't', pronto: 'p', consulta: 'sim' })).toEqual({ tarefa: 't', pronto: 'p' })
  })
})

describe('textos da esteira', () => {
  it('o cérebro é avisado de que o executor é outra IA (sem nomes de ferramentas do Claude) e de quando é consulta', async () => {
    const { esteiraPlanPrompt, executorPrompt } = await import('../../../src/main/team/prompts')
    const p = esteiraPlanPrompt('liste os cards', 'bussola')
    expect(p).toContain('`consulta`')
    expect(p).toContain('ToolSearch')
    expect(p).toContain('mande o executor ler o card')
    expect(executorPrompt({ tarefa: 't', pronto: 'p', consulta: true })).toContain('Responda direto ao Natan')
  })
})
