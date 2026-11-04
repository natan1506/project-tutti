import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { AutonomyPicker } from './AutonomyPicker'
import { getAgent } from '@shared/agents'
import { activeAgents, useProfileStore } from '../state/profileStore'
import { useRunStore } from '../state/runStore'
import { agentColor } from '../stage/colors'

const ERRORS: Record<string, string> = {
  PROJECT_BUSY: 'Já tem um pedido rodando neste projeto. Espere terminar ou cancele.',
  NOT_A_GIT_REPO: 'Esta pasta não usa git; abra o projeto de novo para iniciar um repositório.',
  TOOL_UNAVAILABLE: 'A ferramenta deste agente não está pronta (instale ou entre nela).',
  NO_COORDINATOR: 'Este perfil não tem coordenador: fale direto com um agente.',
}

export function Composer() {
  const { project, selectedAgent, selectAgent, send, tools, fullRound, forcePlan, setTeamOptions } = useRunStore()
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const { active, status } = useProfileStore()
  const agents = useMemo(() => activeAgents(active), [active])
  const coordinator = active.coordinatorId ? getAgent(active.coordinatorId) : undefined
  // Perfil trocado: o agente escolhido precisa existir nele (sem coordenador, não há "Time").
  useEffect(() => {
    const valid = selectedAgent === 'time' ? !!coordinator : agents.some(a => a.id === selectedAgent)
    if (!valid) selectAgent(coordinator ? 'time' : agents[0]?.id ?? 'time')
  }, [agents, coordinator, selectedAgent, selectAgent])

  async function submit() {
    const prompt = text.trim()
    if (!prompt || !project) return
    setError(undefined)
    try {
      await send(prompt)
      setText('')
    } catch (e) {
      const code = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '\w+': (Error: )?/, '')
      setError(ERRORS[code] ?? code)
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() }
  }

  return (
    <div className="composer">
      <div className="chips">
        {coordinator && (
          <button className={`chip ${selectedAgent === 'time' ? 'on' : ''}`} title={`O ${coordinator.nome} organiza o time`} onClick={() => selectAgent('time')}>👥 Time</button>
        )}
        {agents.map(a => {
          const t = tools?.[a.tool]
          const st = status[a.id]
          const hint = st && !st.ok ? st.hint : t && !(t.installed && t.loggedIn) ? t.hint : undefined
          const off = !!(st ? !st.ok : t && !(t.installed && t.loggedIn))
          return (
            <button key={a.id} className={`chip ${a.id === selectedAgent ? 'on' : ''}`} disabled={off}
              title={off ? hint : a.funcao} onClick={() => selectAgent(a.id)}>
              <i className="dot" style={{ background: agentColor(a) }} />{a.nome}
            </button>
          )
        })}
      </div>
      <div className="inp">
        <textarea rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
          placeholder={!project ? 'Escolha um projeto primeiro' : selectedAgent === 'time' ? 'Fale com o time…' : `Fale com ${getAgent(selectedAgent).nome}…`} disabled={!project} />
        <button className="send" onClick={() => void submit()} disabled={!project || !text.trim()}>↑</button>
      </div>
      <div className="hint">
        <span>
          {error ? <b className="err">{error}</b> : selectedAgent === 'time' ? (
            <>
              O time decide quem assume.
              <label className="opt"><input type="checkbox" checked={fullRound} onChange={e => setTeamOptions({ fullRound: e.target.checked })} /> rodada completa</label>
              <label className="opt"><input type="checkbox" checked={forcePlan} onChange={e => setTeamOptions({ forcePlan: e.target.checked })} /> forçar plano</label>
            </>
          ) : 'O pedido vai direto ao agente escolhido.'}
        </span>
        <span>Enter envia · Shift+Enter nova linha</span>
      </div>
      <div className="autonomy-row"><span>Autonomia</span><AutonomyPicker /></div>
    </div>
  )
}
