import { getAgent } from '@shared/agents'
import type { RunBlock } from '../state/chat'

const MARK = { assumo: 'confirmou', assumo_com_ajuda: 'confirmou com ajuda', nao_e_comigo: 'passou', sem_resposta: 'não respondeu' }

/** Rodada de propostas (spec §5.2): nota da triagem; a frase vira a do próprio agente quando ele confirma. */
export function TeamRound({ run }: { run: RunBlock }) {
  if (!run.triage) return <div className="step"><span>⟳ O time está avaliando o pedido…</span></div>
  const scores = [...run.triage.scores].sort((a, b) => b.score - a.score)
  return (
    <div className="round">
      <div className="t">RODADA DE PROPOSTAS</div>
      {scores.map(s => {
        const conf = run.confirmations.find(c => c.agentId === s.agentId)
        const waiting = !conf && !run.lineup && run.triage!.candidates.includes(s.agentId)
        return (
          <div className="prop" key={s.agentId}>
            <div className="r">
              <b className={`c-${s.agentId}`}>{getAgent(s.agentId).nome}</b>
              <div className="bar"><s style={{ width: `${s.score}%` }} /></div>
              <span className="pct">{s.score}%</span>
            </div>
            <div className="why">
              {conf?.line || s.line}
              {conf && <em className="mark"> · {MARK[conf.decision]}</em>}
              {waiting && <em className="mark"> · confirmando…</em>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
