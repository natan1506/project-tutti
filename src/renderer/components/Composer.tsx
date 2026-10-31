import { useState, type KeyboardEvent } from 'react'
import { AGENTS } from '@shared/agents'
import { useRunStore } from '../state/runStore'

const ERRORS: Record<string, string> = {
  PROJECT_BUSY: 'Já tem um pedido rodando neste projeto. Espere terminar ou cancele.',
  NOT_A_GIT_REPO: 'Esta pasta não usa git; abra o projeto de novo para iniciar um repositório.',
  TOOL_UNAVAILABLE: 'A ferramenta deste agente não está pronta (instale ou entre nela).',
}

export function Composer() {
  const { project, selectedAgent, selectAgent, send, tools, fullRound, forcePlan, setTeamOptions } = useRunStore()
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()

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
        <button className={`chip ${selectedAgent === 'time' ? 'on' : ''}`} title="O Bússola organiza o time" onClick={() => selectAgent('time')}>👥 Time</button>
        {AGENTS.map(a => {
          const t = tools?.[a.tool]
          const off = !!t && !(t.installed && t.loggedIn)
          return (
            <button key={a.id} className={`chip ${a.id === selectedAgent ? 'on' : ''}`} disabled={off}
              title={off ? t?.hint : a.funcao} onClick={() => selectAgent(a.id)}>
              <i className={`dot-${a.id}`} />{a.nome}
            </button>
          )
        })}
      </div>
      <div className="inp">
        <textarea rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
          placeholder={!project ? 'Escolha um projeto primeiro' : selectedAgent === 'time' ? 'Fale com o time…' : `Fale com ${AGENTS.find(a => a.id === selectedAgent)!.nome}…`} disabled={!project} />
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
    </div>
  )
}
