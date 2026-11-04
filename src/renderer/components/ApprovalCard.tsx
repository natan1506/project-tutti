import { APPROVAL_REASON_LABEL } from '@shared/autonomy'
import type { Approval } from '../state/chat'

export function ApprovalCard({ approval }: { approval: Approval }) {
  const answered = approval.allowed !== undefined
  return (
    <div className={`approval ${answered ? 'answered' : ''}`}>
      <div className="label">{answered ? (approval.allowed ? 'Permitido' : 'Negado') : `Pede sua aprovação${approval.reason ? ` · ${APPROVAL_REASON_LABEL[approval.reason]}` : ''}`}</div>
      <code>{approval.summary}</code>
      {!answered && (
        <div className="row">
          <button className="primary" onClick={() => void window.time.respondApproval(approval.id, true)}>Permitir</button>
          <button onClick={() => void window.time.respondApproval(approval.id, false)}>Negar</button>
        </div>
      )}
    </div>
  )
}
