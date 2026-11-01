import { describe, expect, it } from 'vitest'
import { getAgent, registerAgents } from '@shared/agents'
import type { AgentEvent } from '@shared/events'
import { resolveAgentDefs } from '@shared/profiles'
import type { AdapterRunOptions, AgentAdapter } from '../../../src/main/adapters/types'
import { TextBrain } from '../../../src/main/team/textBrain'

class Reply implements AgentAdapter {
  seen: AdapterRunOptions[] = []
  constructor(private text: string) {}
  async *run(o: AdapterRunOptions): AsyncGenerator<AgentEvent> { this.seen.push(o); yield { type: 'text', text: this.text }; yield { type: 'done' } }
}

registerAgents(resolveAgentDefs({
  id: 'tb', nome: 'TB', builtin: false, coordinatorId: 'gptchefe', defaults: { transport: { kind: 'api', provider: 'openai' }, model: 'gpt-6.1-terra' },
  agents: [{ id: 'gptchefe', nome: 'Chefe', prompt: 'Coordena.', funcao: 'Coordena', readOnly: false, reviewer: false, consultable: false }],
}))
const input = { cwd: '/p', prompt: 'Crie /health', available: ['gptchefe'], coordinator: 'gptchefe', signal: new AbortController().signal }

describe('TextBrain', () => {
  it('lê o JSON do texto do coordenador, em consulta e com o modelo dele', async () => {
    const a = new Reply('Aqui:\n```json\n{"scores":[],"candidates":[],"big":false}\n```')
    expect(await new TextBrain(a, getAgent('gptchefe')).triage(input)).toEqual({ scores: [], candidates: [], big: false })
    expect(a.seen[0]).toMatchObject({ mode: 'consult', model: 'openai/gpt-6.1-terra' })
    expect(a.seen[0].prompt).toContain('Crie /health')
    expect(a.seen[0].prompt).toContain('"candidates"')
  })
  it('texto sem JSON devolve null', async () => {
    expect(await new TextBrain(new Reply('não sei'), getAgent('gptchefe')).lineup({ ...input, triage: { scores: [], candidates: [], big: false }, confirmations: [] })).toBeNull()
  })
})
