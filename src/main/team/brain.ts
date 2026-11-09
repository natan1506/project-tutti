import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentId } from '@shared/agents'
import type { AgentEvent } from '@shared/events'
import type { Confirmation, EsteiraPlan, Triage } from '@shared/team'
import { homedir } from 'node:os'
import { safeEnv } from '../adapters/env'
import { linearReadOnly, loadUserSkills, userMcpServers } from '../instructions/userContext'
import { writeClaudePlugin } from '../skills/claudePlugin'
import { esteiraPlanPrompt, lineupPrompt, reviewPrompt, triagePrompt } from './prompts'

// O "cérebro" do Bússola: duas chamadas por pedido de time, saída JSON validada por esquema (spike da Fase 3B).

export type UsageSink = (ev: Extract<AgentEvent, { type: 'usage' | 'limit' }>) => void

export interface Brain {
  /** `coordinator`: quem coordena no perfil (padrão: Bússola). */
  /** `onUsage`: tokens gastos pelo cérebro (coordenador por outra ferramenta ou por API). */
  triage(input: { cwd: string; prompt: string; available: AgentId[]; coordinator?: AgentId; signal: AbortSignal; onUsage?: UsageSink }): Promise<unknown>
  lineup(input: { cwd: string; prompt: string; triage: Triage; confirmations: Confirmation[]; available: AgentId[]; coordinator?: AgentId; signal: AbortSignal; onUsage?: UsageSink }): Promise<unknown>
  /** Esteira: o que o executor deve fazer → `{ tarefa, pronto }`. */
  plan(input: { cwd: string; prompt: string; cerebro: AgentId; signal: AbortSignal; onUsage?: UsageSink; instructions?: string }): Promise<unknown>
  /** Esteira: ficou pronto? → `{ pronto, falta }`. */
  review(input: { cwd: string; prompt: string; plan: EsteiraPlan; executor: string; tester: string; cerebro: AgentId; signal: AbortSignal; onUsage?: UsageSink; instructions?: string }): Promise<unknown>
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

/** Instruções do projeto (CLAUDE.md, AGENTS.md, memória) antes do pedido ao cérebro. */
export const withInstructions = (prompt: string, instructions?: string) =>
  instructions?.trim() ? `Instruções do Natan para este projeto (siga-as):\n\n${instructions.trim()}\n\n---\n\n${prompt}` : prompt

export class ClaudeBrain implements Brain {
  /** `ctx`: onde ficam a config do Claude Code (home) e o plugin com as skills do Natan para o cérebro. */
  constructor(private queryFn: QueryFn = query, private ctx?: { homeDir?: string; pluginDir?: string }) {}

  /** Na esteira, o cérebro lê cards do Linear (só leitura) e conhece as skills do Natan. Triagem e escalação não. */
  private esteiraOptions(cwd: string, schema: object, signal: AbortSignal): Options {
    const o = this.options(cwd, schema, signal)
    const home = this.ctx?.homeDir ?? homedir()
    const skills = loadUserSkills(home)
    const plugin = skills.length && this.ctx?.pluginDir ? writeClaudePlugin(this.ctx.pluginDir, [], skills) : undefined
    return {
      ...o,
      mcpServers: userMcpServers(home, ['linear']) as Options['mcpServers'],
      canUseTool: async (toolName, input) => (linearReadOnly(toolName) || toolName === 'Skill'
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'O cérebro só lê cards do Linear e usa skills; não altera nada.' }),
      ...(plugin ? { plugins: [{ type: 'local', path: plugin.path }], skills: plugin.names } : {}),
    }
  }

  options(cwd: string, schema: object, signal: AbortSignal): Options {
    const abortController = new AbortController()
    signal.addEventListener('abort', () => abortController.abort(), { once: true })
    return {
      cwd, model: BRAIN_MODEL, env: safeEnv(k => k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')),
      settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [], skills: [], disallowedTools: NO_TOOLS,
      permissionMode: 'default', outputFormat: { type: 'json_schema', schema: schema as Record<string, unknown> }, abortController,
    }
  }

  private async ask(prompt: string, options: Options, onUsage?: UsageSink): Promise<unknown> {
    for await (const m of this.queryFn({ prompt, options })) {
      if (m.type !== 'result') continue
      // O gasto do cérebro conta no uso (spec tutti-terminal §1: ver se a divisão economiza de verdade).
      const u = (m as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } }).usage
      if (u && typeof u.input_tokens === 'number') {
        onUsage?.({ type: 'usage', tool: 'claude', tokens: { input: u.input_tokens, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, reasoning: 0 } })
      }
      if (m.subtype === 'success') return (m as { structured_output?: unknown }).structured_output
      throw new Error(`O Bússola não devolveu um resultado válido (${m.subtype}).`)
    }
    return undefined
  }

  triage(i: Parameters<Brain['triage']>[0]) {
    return this.ask(triagePrompt(i.prompt, i.available, i.coordinator), this.options(i.cwd, TRIAGE_SCHEMA, i.signal), i.onUsage)
  }

  lineup(i: Parameters<Brain['lineup']>[0]) {
    return this.ask(lineupPrompt(i.prompt, i.triage, i.confirmations, i.available, i.coordinator), this.options(i.cwd, LINEUP_SCHEMA, i.signal), i.onUsage)
  }

  plan(i: Parameters<Brain['plan']>[0]) {
    return this.ask(withInstructions(esteiraPlanPrompt(i.prompt, i.cerebro), i.instructions), this.esteiraOptions(i.cwd, PLAN_SCHEMA, i.signal), i.onUsage)
  }

  review(i: Parameters<Brain['review']>[0]) {
    return this.ask(withInstructions(reviewPrompt(i.prompt, i.plan, i.executor, i.tester, i.cerebro), i.instructions), this.esteiraOptions(i.cwd, REVIEW_SCHEMA, i.signal), i.onUsage)
  }
}
