import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentId } from '@shared/agents'
import type { AgentEvent } from '@shared/events'
import type { Confirmation, EsteiraPlan, Triage } from '@shared/team'
import type { CheckResult } from './check'
import { homedir, tmpdir } from 'node:os'
import { safeEnv } from '../adapters/env'
import { executableFor } from '../adapters/executables'
import { loadUserSkills } from '../instructions/userContext'
import { mcpToolAccess, resolveMcps, type AgentMcp } from '../mcp/forAgent'
import { readToolNames } from '@shared/mcp'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
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
  review(input: { cwd: string; prompt: string; plan: EsteiraPlan; executor: string; tester: string; cerebro: AgentId; signal: AbortSignal; onUsage?: UsageSink; instructions?: string; check?: CheckResult }): Promise<unknown>
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

export const PLAN_SCHEMA = obj({ tarefa: { type: 'string' }, pronto: { type: 'string' }, comando: { type: 'string' }, consulta: { type: 'boolean' } })
export const REVIEW_SCHEMA = obj({ pronto: { type: 'boolean' }, falta: { type: 'string' } })

const NO_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'Task', 'Read', 'Glob', 'Grep', 'TodoWrite']
const BRAIN_MODEL = 'claude-sonnet-5-5'

type QueryFn = typeof query

/** Instruções do projeto (CLAUDE.md, AGENTS.md, memória) antes do pedido ao cérebro. */
export const withInstructions = (prompt: string, instructions?: string) =>
  instructions?.trim() ? `Instruções do Natan para este projeto (siga-as):\n\n${instructions.trim()}\n\n---\n\n${prompt}` : prompt

export class ClaudeBrain implements Brain {
  /** `ctx`: onde ficam a config do Claude Code (home) e o plugin com as skills do Natan para o cérebro. */
  constructor(private queryFn: QueryFn = query, private ctx?: { homeDir?: string; pluginDir?: string; mcpFor?: (agentId: string) => AgentMcp[] }) {}

  /**
   * Na esteira, o cérebro usa os MCPs do agente dele **só para ler** (no meio do plano não há aprovação) e conhece as
   * skills do Natan. Triagem e escalação não. Devolve as opções e a limpeza dos arquivos do lançador.
   */
  private esteiraOptions(cwd: string, schema: object, signal: AbortSignal, cerebro: string): { options: Options; done(): void } {
    const o = this.options(cwd, schema, signal)
    const home = this.ctx?.homeDir ?? homedir()
    const skills = loadUserSkills(home)
    const plugin = skills.length && this.ctx?.pluginDir ? writeClaudePlugin(this.ctx.pluginDir, [], skills) : undefined
    const mine = (this.ctx?.mcpFor?.(cerebro) ?? []).map(m => ({ ...m, allowed: readToolNames(m.def) }))
    const dir = mine.length ? mkdtempSync(join(tmpdir(), 'tutti-mcp-')) : undefined
    const resolved = dir ? resolveMcps(mine, dir) : undefined
    const mcpServers = Object.fromEntries((resolved?.list ?? []).map(m => [m.nome, m.launch.kind === 'http'
      ? { type: 'http' as const, url: m.launch.url }
      : { type: 'stdio' as const, command: m.launch.command, args: m.launch.args, env: m.launch.env }]))
    return {
      options: {
        ...o, mcpServers,
        canUseTool: async (toolName, input) => (toolName === 'Skill' || toolName === 'ToolSearch' || mcpToolAccess(resolved?.list ?? [], toolName) === 'read'
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'O cérebro só lê (MCPs de leitura) e usa skills; não altera nada.' }),
        ...(plugin ? { plugins: [{ type: 'local', path: plugin.path }], skills: plugin.names } : {}),
      },
      done: () => { resolved?.cleanup(); if (dir) rmSync(dir, { recursive: true, force: true }) },
    }
  }

  private async askEsteira(prompt: string, cwd: string, schema: object, signal: AbortSignal, cerebro: string, onUsage?: UsageSink): Promise<unknown> {
    const e = this.esteiraOptions(cwd, schema, signal, cerebro)
    try { return await this.ask(prompt, e.options, onUsage) } finally { e.done() }
  }

  options(cwd: string, schema: object, signal: AbortSignal): Options {
    const abortController = new AbortController()
    signal.addEventListener('abort', () => abortController.abort(), { once: true })
    return {
      cwd, model: BRAIN_MODEL, env: safeEnv(k => k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')),
      ...(executableFor('claude') ? { pathToClaudeCodeExecutable: executableFor('claude') } : {}),
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
    return this.askEsteira(withInstructions(esteiraPlanPrompt(i.prompt, i.cerebro), i.instructions), i.cwd, PLAN_SCHEMA, i.signal, i.cerebro, i.onUsage)
  }

  review(i: Parameters<Brain['review']>[0]) {
    return this.askEsteira(withInstructions(reviewPrompt(i.prompt, i.plan, i.executor, i.tester, i.cerebro, i.check), i.instructions), i.cwd, REVIEW_SCHEMA, i.signal, i.cerebro, i.onUsage)
  }
}
