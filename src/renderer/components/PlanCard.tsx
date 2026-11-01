import { getAgent } from '@shared/agents'
import type { RunBlock } from '../state/chat'

/** Plano de pedido grande (spec §5.3): nada é tocado até o Natan aprovar. */
export function PlanCard({ run }: { run: RunBlock }) {
  if (!run.plan || !run.lineup) return null
  const answered = run.plan.approved !== undefined
  return (
    <div className={`approval plan ${answered ? 'answered' : ''}`}>
      <div className="label">{answered ? (run.plan.approved ? 'Plano aprovado' : 'Plano recusado') : 'Plano para aprovar'}</div>
      <ol>
        {run.lineup.steps.map((s, i) => (
          <li key={i}>
            <b>{getAgent(s.agentId).nome}</b>: {s.task}{s.areas.length ? <code> {s.areas.join(', ')}</code> : null}
            {s.paid && <span className="paid">API paga — {s.paid.provider}</span>}
          </li>
        ))}
      </ol>
      {!answered && (
        <div className="row">
          <button className="primary" onClick={() => void window.time.respondPlan(run.plan!.id, true)}>Aprovar</button>
          <button onClick={() => void window.time.respondPlan(run.plan!.id, false)}>Recusar</button>
        </div>
      )}
    </div>
  )
}
