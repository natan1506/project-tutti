import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentId } from '@shared/agents'
import type { AgentEvent } from '@shared/events'
import type { Confirmation, EsteiraPlan, Triage } from '@shared/team'
import { safeEnv } from '../adapters/env'
import { esteiraPlanPrompt, lineupPrompt, reviewPrompt, triagePrompt } from './prompts'

// O "cérebro" do Bússola: duas chamadas por pedido de time, saída JSON validada por esquema (spike da Fase 3B).

export type UsageSink = (ev: Extract<AgentEvent, { type: 'usage' | 'limit' }>) => void

export interface Brain {
  /** `coordinator`: quem coordena no perfil (padrão: Bússola). */
  /** `onUsage`: tokens gastos pelo cérebro (coordenador por outra ferramenta ou por API). */
  triage(input: { cwd: string; prompt: string; available: AgentId[]; coordinator?: AgentId; signal: AbortSignal; onUsage?: UsageSink }): Promise<unknown>
  lineup(input: { cwd: string; prompt: string; triage: Triage; confirmations: Confirmation[]; available: AgentId[]; coordinator?: AgentId; signal: AbortSignal; onUsage?: UsageSink }): Promise<unknown>
  /** Esteira: o que o executor deve fazer → `{ tarefa, pronto }`. */
  plan(input: { cwd: string; prompt: string; cerebro: AgentId; signal: AbortSignal; onUsage?: UsageSink }): Promise<unknown>
  /** Esteira: ficou pronto? → `{ pronto, falta }`. */
  review(input: { cwd: string; prompt: string; plan: EsteiraPlan; executor: string; tester: string; cerebro: AgentId; signal: AbortSignal; onUsage?: UsageSink }): Promise<unknown>
}

const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties })

export const TRIAGE_SCHEMA = obj({
  scores: { type: 'array', items: obj({ agentId: { type: 'string' }, score: { type: 'integer' }, line: { type: 'string' } }) },
  candidates: { type: 'array', items: { type: 'string' } },
  big: { type: 'boolean' },
})

export const LINEUP_SCHEMA = obj({
  summary: { type: 'string' },
  big: { type: 'boolean' },
  steps: {
    type: 'array',
    items: obj({ agentId: { type: 'string' }, task: { type: 'string' }, model: { type: 'string' }, areas: { type: 'array', items: { type: 'string' } } }, ['agentId', 'task', 'areas']),
  },
})

export const PLAN_SCHEMA = obj({ tarefa: { type: 'string' }, pronto: { type: 'string' } })
export const REVIEW_SCHEMA = obj({ pronto: { type: 'boolean' }, falta: { type: 'string' } })

const NO_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'Task', 'Read', 'Glob', 'Grep', 'TodoWrite']
const BRAIN_MODEL = 'claude-sonnet-5-5'

type QueryFn = typeof query

export class ClaudeBrain implements Brain {
  constructor(private queryFn: QueryFn = query) {}

  options(cwd: string, schema: object, signal: AbortSignal): Options {
    const abortController = new AbortController()
    signal.addEventListener('abort', () => abortController.abort(), { once: true })
    return {
      cwd, model: BRAIN_MODEL, env: safeEnv(k => k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')),
      settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [], skills: [], disallowedTools: NO_TOOLS,
      permissionMode: 'default', outputFormat: { type: 'json_schema', schema: schema as Record<string, unknown> }, abortController,
    }
  }

  private async ask(prompt: string, options: Options): Promise<unknown> {
    for await (const m of this.queryFn({ prompt, options })) {
      if (m.type !== 'result') continue
      if (m.subtype === 'success') return (m as { structured_output?: unknown }).structured_output
      throw new Error(`O Bússola não devolveu um resultado válido (${m.subtype}).`)
    }
    return undefined
  }

  triage(i: Parameters<Brain['triage']>[0]) {
    return this.ask(triagePrompt(i.prompt, i.available, i.coordinator), this.options(i.cwd, TRIAGE_SCHEMA, i.signal))
  }

  lineup(i: Parameters<Brain['lineup']>[0]) {
    return this.ask(lineupPrompt(i.prompt, i.triage, i.confirmations, i.available, i.coordinator), this.options(i.cwd, LINEUP_SCHEMA, i.signal))
  }

  plan(i: Parameters<Brain['plan']>[0]) {
    return this.ask(esteiraPlanPrompt(i.prompt, i.cerebro), this.options(i.cwd, PLAN_SCHEMA, i.signal))
  }

  review(i: Parameters<Brain['review']>[0]) {
    return this.ask(reviewPrompt(i.prompt, i.plan, i.executor, i.tester, i.cerebro), this.options(i.cwd, REVIEW_SCHEMA, i.signal))
  }
}
