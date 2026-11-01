import { getAgent, type AgentId } from '@shared/agents'
import { agentColor } from '../colors'
import { Clawd } from './Clawd'
import { CodexCloud } from './CodexCloud'
import { GeminiStar } from './GeminiStar'
import { OpencodeBlock } from './OpencodeBlock'
import type { BodyProps } from './types'

export type { BodyProps } from './types'

/** Mascote = família do modelo do agente (spec custos-e-perfis §6); no Claude, coordenador tem bracinhos e a cor varia por tom. */
export function MascotBody({ agentId, ...p }: BodyProps & { agentId: AgentId }) {
  const a = getAgent(agentId)
  switch (a.family) {
    case 'claude': return <Clawd {...p} color={agentColor(a)} variant={a.coordinator ? 'arms' : 'ears'} />
    case 'gemini': return <GeminiStar {...p} />
    case 'gpt': return <CodexCloud {...p} />
    default: return <OpencodeBlock {...p} />
  }
}
