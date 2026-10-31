import type { AgentDef } from '@shared/agents'
import type { AgentEvent } from '@shared/events'

export interface AdapterRunOptions {
  agent: AgentDef
  prompt: string
  cwd: string
  model?: string
  instructions: string
  resumeSessionId?: string
  /** `consult` = só leitura em qualquer ferramenta (triagem, confirmação, chamadas entre agentes). Padrão: `work`. */
  mode?: 'work' | 'consult'
  signal: AbortSignal
  requestApproval(req: { toolName: string; summary: string }): Promise<boolean>
  /** Pergunta em texto livre ao Natan (spec §5.7.2); `null` = sem resposta (cancelado). */
  askUser?(q: { text: string; options?: string[] }): Promise<string | null>
}

export interface AgentAdapter {
  run(opts: AdapterRunOptions): AsyncIterable<AgentEvent>
}

export function systemAppend(agent: AgentDef, instructions: string): string {
  return [agent.persona, instructions].filter(Boolean).join('\n\n')
}
