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

export function systemAppend(agent: AgentDef, instructions: string): string {
  return [agent.persona, instructions].filter(Boolean).join('\n\n')
}
