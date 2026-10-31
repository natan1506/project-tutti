import { useState } from 'react'
import type { Question } from '../state/chat'

export function QuestionCard({ question }: { question: Question }) {
  const [text, setText] = useState('')
  const answered = question.answer !== undefined
  const send = (answer: string) => { if (answer.trim()) void window.time.answerQuestion(question.id, answer.trim()) }
  return (
    <div className={`approval question ${answered ? 'answered' : ''}`}>
      <div className="label">{answered ? 'Pergunta respondida' : 'Pergunta para você'}</div>
      <div className="q">{question.text}</div>
      {answered ? (
        <div className="note">{question.answer ?? 'Sem resposta (pedido cancelado).'}</div>
      ) : (
        <>
          {!!question.options?.length && (
            <div className="row">{question.options.map(o => <button key={o} onClick={() => send(o)}>{o}</button>)}</div>
          )}
          <div className="row">
            <input className="answer" value={text} onChange={e => setText(e.target.value)} placeholder="Sua resposta"
              onKeyDown={e => { if (e.key === 'Enter') send(text) }} />
            <button className="primary" onClick={() => send(text)} disabled={!text.trim()}>Responder</button>
          </div>
        </>
      )}
    </div>
  )
}
