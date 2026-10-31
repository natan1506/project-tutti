import { useState, type KeyboardEvent } from 'react'
import { AGENTS } from '@shared/agents'
import { useRunStore } from '../state/runStore'

const LATER = 'chega na Fase 3'
const ERRORS: Record<string, string> = {
  PROJECT_BUSY: 'Já tem um pedido rodando neste projeto. Espere terminar ou cancele.',
  NOT_A_GIT_REPO: 'Esta pasta não usa git; abra o projeto de novo para iniciar um repositório.',
  AGENT_NOT_AVAILABLE: 'Este agente chega na Fase 3.',
}

export function Composer() {
  const { project, selectedAgent, selectAgent, send } = useRunStore()
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
        <button className="chip" disabled title={LATER}>👥 Time</button>
        {AGENTS.map(a => (
          <button key={a.id} className={`chip ${a.id === selectedAgent ? 'on' : ''}`} disabled={a.availableInPhase !== 1}
            title={a.availableInPhase !== 1 ? LATER : a.funcao} onClick={() => selectAgent(a.id)}>
            <i className={`dot-${a.id}`} />{a.nome}
          </button>
        ))}
      </div>
      <div className="inp">
        <textarea rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
          placeholder={project ? `Fale com ${AGENTS.find(a => a.id === selectedAgent)!.nome}…` : 'Escolha um projeto primeiro'} disabled={!project} />
        <button className="send" onClick={() => void submit()} disabled={!project || !text.trim()}>↑</button>
      </div>
      <div className="hint">
        <span>{error ? <b className="err">{error}</b> : 'Na Fase 1 o pedido vai direto ao agente escolhido.'}</span>
        <span>Enter envia · Shift+Enter nova linha</span>
      </div>
    </div>
  )
}
