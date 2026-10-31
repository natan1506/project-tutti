import { getAgent } from '@shared/agents'
import type { RunBlock } from '../state/chat'

/** Mensagem do Bússola com a escalação; agentes da mesma onda aparecem lado a lado. */
export function LineupCard({ run }: { run: RunBlock }) {
  if (!run.lineup || !run.waves) return null
  return (
    <div className="msg msg-bussola">
      <div className="who">Bússola</div>
      {run.lineup.summary && <div className="tx">{run.lineup.summary}</div>}
      <div className="tags">
        {run.waves.map((wave, w) => (
          <span key={w} className="wave">
            {wave.map(i => <span key={i} className="chip-agent">→ {getAgent(run.lineup!.steps[i].agentId).nome}</span>)}
          </span>
        ))}
      </div>
    </div>
  )
}
