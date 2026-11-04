import { getAgent, type AgentId } from '@shared/agents'
import { resolveLook, type Look } from '@shared/look'
import { agentColor } from '../colors'
import { Clawd } from './Clawd'
import { CodexCloud } from './CodexCloud'
import { GeminiStar } from './GeminiStar'
import { OpencodeBlock } from './OpencodeBlock'
import type { BodyProps } from './types'

export type { BodyProps } from './types'

/** Corpo e cor do agente: o que o Natan escolheu em Mascotes, senão a família do modelo (spec custos-e-perfis §6). */
export function MascotBody({ agentId, look, ...p }: BodyProps & { agentId: AgentId; look?: Look }) {
  const a = getAgent(agentId)
  const l = resolveLook(a, agentColor(a), look)
  switch (l.body) {
    case 'clawd-arms': return <Clawd {...p} color={l.color} variant="arms" />
    case 'clawd-ears': return <Clawd {...p} color={l.color} variant="ears" />
    case 'star': return <GeminiStar {...p} />
    case 'cloud': return <CodexCloud {...p} />
    default: return <OpencodeBlock {...p} />
  }
}
