import { getAgent } from '@shared/agents'
import type { LimitWarning } from '../state/chat'
import { TOOL_NAME } from './UsagePanel'

const WINDOW = { five_hour: 'de 5 horas', seven_day: 'semanal', seven_day_model: 'semanal do modelo', estimated: 'estimado de hoje' }

/** Spec custos-e-perfis §5: avisar e perguntar se pode passar o trabalho. */
export function LimitWarningCard({ warning, agentName }: { warning: LimitWarning; agentName: string }) {
  const answered = warning.pass !== undefined
  const head = `O ${TOOL_NAME[warning.tool]} está em ${warning.utilization}% do limite ${WINDOW[warning.window]}.`
  return (
    <div className={`approval limit ${answered ? 'answered' : ''}`}>
      <div className="label">{answered ? (warning.pass ? 'Trabalho passado' : 'Seguiu como estava') : 'Limite quase no fim'}</div>
      <div className="q">
        {head}{' '}
        {warning.to ? `Posso passar o trabalho do ${agentName} para o ${getAgent(warning.to).nome}?` : 'Nenhum outro agente tem folga agora.'}
      </div>
      {!answered && (
        <div className="row">
          {warning.to && <button className="primary" onClick={() => void window.time.respondLimit(warning.id, true)}>Passar</button>}
          <button onClick={() => void window.time.respondLimit(warning.id, false)}>Continuar</button>
        </div>
      )}
    </div>
  )
}
