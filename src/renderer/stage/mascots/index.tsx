import type { AgentId } from '@shared/agents'
import { Clawd } from './Clawd'
import { CodexCloud } from './CodexCloud'
import { GeminiStar } from './GeminiStar'
import { OpencodeBlock } from './OpencodeBlock'
import type { BodyProps } from './types'

export type { BodyProps } from './types'

/** Mascote = identidade da ferramenta do agente; a função muda cor e acessório (spec §4). */
export function MascotBody({ agentId, ...p }: BodyProps & { agentId: AgentId }) {
  switch (agentId) {
    case 'bussola': return <Clawd {...p} color="#d97757" variant="arms" />
    case 'forja': return <Clawd {...p} color="#c9643f" variant="ears" />
    case 'pincel': return <Clawd {...p} color="#e2b56f" variant="ears" />
    case 'radar': return <GeminiStar {...p} />
    case 'lupa': return <CodexCloud {...p} />
    case 'curinga': return <OpencodeBlock {...p} />
  }
}
