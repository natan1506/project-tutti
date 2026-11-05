import { describe, expect, it } from 'vitest'
import { approvalPhrase, cleanForSpeech, speechFor, VoiceQueue, type SpeechItem } from '../../src/shared/voice'

const run = (p: Partial<{ agentId: string; text: string; team: boolean; parentRunId: string }> = {}) => ({ agentId: 'forja', text: '', ...p })
const ctx = { coordinatorId: 'bussola', toolName: (t: string) => ({ claude: 'Claude Code' }[t] ?? t) }

describe('texto falado', () => {
  it('tira código, markdown e links; fica na primeira frase e no limite', () => {
    expect(cleanForSpeech('**Pronto!** Criei o `api.ts` em https://x.dev/a.\n```ts\nconst a = 1\n```\nMais coisa.')).toBe('Pronto!')
    expect(cleanForSpeech('# Título\nFeito o ajuste no login sem quebrar nada')).toBe('Título. Feito o ajuste no login sem quebrar nada')
    expect(cleanForSpeech('a'.repeat(300)).length).toBeLessThanOrEqual(200)
    expect(cleanForSpeech('```\nsó código\n```')).toBe('')
  })
})

describe('o que é falado (§6.2)', () => {
  it('pedido direto terminou: o agente fala a primeira frase', () => {
    expect(speechFor({ type: 'run_finished', status: 'done' }, run({ text: 'Feito. Detalhes depois.' }), ctx))
      .toEqual({ agentId: 'forja', text: 'Feito.', kind: 'done' })
  })
  it('aprovação, pergunta e plano são alertas', () => {
    expect(speechFor({ type: 'approval_request', id: '1', toolName: 'Bash', summary: 'rm -rf dist', reason: 'destructive' }, run(), ctx))
      .toEqual({ agentId: 'forja', text: 'Preciso da sua aprovação para rodar um comando que apaga ou não tem volta.', kind: 'alert' })
    expect(speechFor({ type: 'question', id: 'q', text: 'Qual banco?' }, run(), ctx))
      .toEqual({ agentId: 'forja', text: 'Tenho uma pergunta. Qual banco?', kind: 'alert' })
    expect(speechFor({ type: 'plan_request', id: 'p' }, run({ agentId: 'bussola', team: true }), ctx))
      .toEqual({ agentId: 'bussola', text: 'O plano está pronto. Pode aprovar?', kind: 'alert' })
  })
  it('time terminou: o coordenador fala; agentes filhos não falam "terminei"', () => {
    expect(speechFor({ type: 'run_finished', status: 'done' }, run({ agentId: 'bussola', team: true, text: 'Tudo certo no login.' }), ctx))
      .toEqual({ agentId: 'bussola', text: 'Tudo certo no login.', kind: 'done' })
    expect(speechFor({ type: 'run_finished', status: 'done' }, run({ parentRunId: 't1', text: 'Feito.' }), ctx)).toBeUndefined()
  })
  it('aviso de limite e erro', () => {
    expect(speechFor({ type: 'limit_warning', id: 'w', tool: 'claude', window: 'five_hour', utilization: 92 }, run(), ctx))
      .toEqual({ agentId: 'forja', text: 'O Claude Code está em 92% do limite.', kind: 'alert' })
    expect(speechFor({ type: 'error', message: 'falhou ao ler\nstack' }, run(), ctx))
      .toEqual({ agentId: 'forja', text: 'Deu erro: falhou ao ler', kind: 'done' })
  })
  it('passos, texto parcial e cancelado não falam', () => {
    expect(speechFor({ type: 'tool', name: 'Bash', summary: 'ls' }, run(), ctx)).toBeUndefined()
    expect(speechFor({ type: 'text', text: 'oi' }, run(), ctx)).toBeUndefined()
    expect(speechFor({ type: 'run_finished', status: 'cancelled' }, run({ text: 'x' }), ctx)).toBeUndefined()
    expect(speechFor({ type: 'run_finished', status: 'done' }, run({ text: '```\ncode\n```' }), ctx)).toBeUndefined()
  })
})

describe('aprovação em frase curta (sem comando nem caminho)', () => {
  it.each([
    ['Read', 'outside', 'Preciso da sua aprovação para ler um arquivo fora do projeto.'],
    ['Edit', undefined, 'Preciso da sua aprovação para editar um arquivo.'],
    ['WebFetch', 'network', 'Preciso da sua aprovação para acessar a internet.'],
    ['Bash', 'outside', 'Preciso da sua aprovação para rodar um comando fora do projeto.'],
    ['mcp__x__y', 'unknown', 'Preciso da sua aprovação para continuar.'],
  ] as const)('%s / %s', (toolName, reason, text) => {
    expect(approvalPhrase(toolName, reason)).toBe(text)
  })
})

describe('fila de fala', () => {
  const item = (text: string, kind: SpeechItem['kind'] = 'done'): SpeechItem => ({ agentId: 'forja', text, kind })

  it('alertas passam na frente dos "terminei"', () => {
    const q = new VoiceQueue()
    q.push(item('d1')); q.push(item('d2')); q.push(item('a1', 'alert'))
    expect([q.next()?.text, q.next()?.text, q.next()?.text]).toEqual(['a1', 'd1', 'd2'])
  })
  it('mais de 3 esperando descarta os "terminei" mais antigos', () => {
    const q = new VoiceQueue()
    for (const t of ['d1', 'd2', 'd3', 'd4']) q.push(item(t))
    q.push(item('a1', 'alert'))
    expect(q.size()).toBe(3)
    expect([q.next()?.text, q.next()?.text, q.next()?.text]).toEqual(['a1', 'd3', 'd4'])
  })
  it('limpar esvazia', () => {
    const q = new VoiceQueue()
    q.push(item('d1')); q.clear()
    expect(q.next()).toBeUndefined()
  })
})
