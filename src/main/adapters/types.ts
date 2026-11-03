import type { AgentDef } from '@shared/agents'
import type { AgentEvent } from '@shared/events'
import type { AskAgent } from '../team/agentCalls'

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
  /** Pergunta ao Radar ou ao Lupa no meio do trabalho (spec §5.4); só o adaptador Claude usa. */
  askAgent?: AskAgent
  /** Quem pode ser consultado (perfil do agente); vazio = sem ferramenta de consulta. */
  consultable?: AgentDef[]
  /** Skills marcadas para o agente, como plugin local (só o adaptador Claude usa; os outros recebem nas instruções). */
  skillPlugin?: { path: string; names: string[] }
}

export interface AgentAdapter {
  run(opts: AdapterRunOptions): AsyncIterable<AgentEvent>
}

export function systemAppend(agent: AgentDef, instructions: string): string {
  return [agent.persona, instructions].filter(Boolean).join('\n\n')
}
