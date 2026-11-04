import { useEffect, useRef, useState } from 'react'
import { getAgent } from '@shared/agents'
import { useRunStore } from '../state/runStore'
import type { RunBlock } from '../state/chat'
import { ApprovalCard } from './ApprovalCard'
import { QuestionCard } from './QuestionCard'
import { DiffCard } from './DiffCard'
import { LimitWarningCard } from './LimitWarningCard'
import { LineupCard } from './LineupCard'
import { PlanCard } from './PlanCard'
import { TeamRound } from './TeamRound'
import { SideResizer } from './SideResizer'

const FINISHED: Record<string, string> = { cancelled: 'cancelado', error: 'parou com erro', interrupted: 'interrompido (app fechado)' }

function RunView({ run, nested = false }: { run: RunBlock; nested?: boolean }) {
  const [open, setOpen] = useState(false)
  const nome = getAgent(run.agentId).nome
  const secs = run.finishedAt ? Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000)) : undefined
  const n = run.steps.length
  const passos = `${n} ${n === 1 ? 'passo' : 'passos'}`
  return (
    <>
      {run.prompt && !nested && <><div className="me-l">Para {nome}</div><div className="me">{run.prompt}</div></>}
      {run.queued !== undefined && <Queued run={run} />}
      <div className="step" onClick={() => setOpen(o => !o)}>
        <span>
          {run.status === 'running' ? `⟳ ${nome} está trabalhando`
            : run.status === 'done' ? `✓ ${nome} concluiu${secs ? ` em ${secs} s` : ''}`
            : `■ ${nome}: ${FINISHED[run.status]}`}
        </span>
        <small>{passos} {open ? '▾' : '›'}</small>
      </div>
      {open && <ul className="steps">{run.steps.map((s, i) => <li key={i}><b>{s.name}</b> <code>{s.summary}</code></li>)}</ul>}
      {run.notices.map((n, i) => <div key={i} className="note">{n}</div>)}
      {run.status === 'running' && <button className="link" onClick={() => void window.time.cancelRun(run.runId)}>Cancelar</button>}
      {run.approvals.map(a => <ApprovalCard key={a.id} approval={a} />)}
      {run.questions.map(q => <QuestionCard key={q.id} question={q} />)}
      {run.limitWarnings.map(w => <LimitWarningCard key={w.id} warning={w} agentName={nome} />)}
      {run.handoff && <div className="note">Trabalho passado para o {getAgent(run.handoff.to).nome}.</div>}
      {run.calls.map((c, i) => (
        <div key={i} className="note call">→ perguntou ao {getAgent(c.to).nome}: {c.question}{c.answer !== undefined && <><br />← {c.answer}</>}</div>
      ))}
      {run.text && <div className={`msg msg-${run.agentId}`}><div className="who">{nome}</div><div className="tx">{run.text}</div></div>}
      {run.error && <div className="note err">{run.error}</div>}
      {run.status !== 'running' && !nested && <DiffCard run={run} />}
    </>
  )
}

function Queued({ run }: { run: RunBlock }) {
  return (
    <div className="note">
      Na fila (posição {run.queued}) — começa quando o pedido atual terminar.{' '}
      <button className="link" onClick={() => void window.time.cancelRun(run.runId)}>Tirar da fila</button>
    </div>
  )
}

/** Pedido de time: rodada, escalação, plano, passos dos agentes (aninhados) e o diff do pedido inteiro. */
function TeamView({ run, all }: { run: RunBlock; all: RunBlock[] }) {
  const children = run.children.map(id => all.find(r => r.runId === id)).filter((r): r is RunBlock => !!r)
  return (
    <>
      <div className="me-l">Para o time</div>
      <div className="me">{run.prompt}</div>
      {run.queued !== undefined && <Queued run={run} />}
      <TeamRound run={run} />
      <LineupCard run={run} />
      <PlanCard run={run} />
      {children.length > 0 && <div className="children">{children.map(c => <RunView key={c.runId} run={c} nested />)}</div>}
      {run.text && <div className="msg msg-bussola"><div className="who">Bússola</div><div className="tx">{run.text}</div></div>}
      {run.error && <div className="note err">{run.error}</div>}
      {run.status === 'running' && <button className="link" onClick={() => void window.time.cancelRun(run.runId)}>Cancelar pedido</button>}
      {run.status !== 'running' && <DiffCard run={run} />}
    </>
  )
}

export function ChatPanel() {
  const { chat, conversation, project, newConversation } = useRunStore()
  const log = useRef<HTMLDivElement>(null)
  // Rola só a lista de mensagens; scrollIntoView rolaria também o palco e o app inteiro.
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }) }, [chat])
  return (
    <aside className="side">
      <SideResizer />
      <div className="top">
        <span className="ttl" title={conversation?.title}>{conversation?.title ?? 'Conversa'}</span>
        {project && <button className="new-conv" title="Começar uma conversa nova" onClick={newConversation}>＋ Nova conversa</button>}
      </div>
      <div className="log" ref={log}>
        {chat.runs.length === 0 && (
          <div className="empty">
            <h3>Fale com o time</h3>
            <p>{project ? 'Peça algo para o time ou escolha um agente embaixo. Você acompanha cada passo e decide o que fica.' : 'Abra um projeto no topo para começar.'}</p>
          </div>
        )}
        {chat.runs.filter(r => !r.parentRunId).map(r => (r.team ? <TeamView key={r.runId} run={r} all={chat.runs} /> : <RunView key={r.runId} run={r} />))}
      </div>
    </aside>
  )
}
