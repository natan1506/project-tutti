// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { registerAgents } from '@shared/agents'
import { resolveAgentDefs } from '@shared/profiles'
import { LimitWarningCard } from '../../src/renderer/components/LimitWarningCard'
import { PlanCard } from '../../src/renderer/components/PlanCard'
import type { RunBlock } from '../../src/renderer/state/chat'

afterEach(cleanup)

registerAgents(resolveAgentDefs({ id: 'pp', nome: 'P', builtin: false, defaults: { transport: { kind: 'api', provider: 'openrouter' }, model: 'moonshotai/kimi-k3.1-pro' },
  agents: [{ id: 'kimi', nome: 'Kimi', prompt: 'x', funcao: 'x', readOnly: false, reviewer: false, consultable: false }] }))

describe('API paga na interface', () => {
  it('aviso de limite diz que o destino é pago', () => {
    const { container } = render(<LimitWarningCard agentName="Forja" warning={{ id: 'w', tool: 'claude', window: 'five_hour', utilization: 92, to: 'kimi', paid: { provider: 'OpenRouter' } }} />)
    expect(container.textContent).toContain('Posso passar o trabalho do Forja para o Kimi (API paga — OpenRouter)?')
  })
  it('passo pago tem selo no plano', () => {
    const run = { plan: { id: 'p' }, lineup: { summary: '', big: true, steps: [{ agentId: 'kimi', task: 'Criar a.html', areas: ['web'], paid: { provider: 'OpenRouter' } }] } } as unknown as RunBlock
    const { container } = render(<PlanCard run={run} />)
    expect(container.querySelector('.paid')?.textContent).toBe('API paga — OpenRouter')
  })
})
