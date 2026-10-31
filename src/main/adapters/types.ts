import type { AgentDef } from '@shared/agents'
import type { AgentEvent } from '@shared/events'

export interface AdapterRunOptions {
  agent: AgentDef
  prompt: string
  cwd: string
  model?: string
  instructions: string
  resumeSessionId?: string
  signal: AbortSignal
  requestApproval(req: { toolName: string; summary: string }): Promise<boolean>
}

export interface AgentAdapter {
  run(opts: AdapterRunOptions): AsyncIterable<AgentEvent>
}

/** Ambiente do processo filho sem chaves de API (só assinatura) e sem variáveis herdadas da sessão Claude. */
export function childEnv(drop: (key: string) => boolean): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !drop(k)) env[k] = v
  return env
}

export function systemAppend(agent: AgentDef, instructions: string): string {
  return [agent.persona, instructions].filter(Boolean).join('\n\n')
}
