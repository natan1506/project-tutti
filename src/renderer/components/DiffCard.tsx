import { useState } from 'react'
import type { RunBlock } from '../state/chat'
import { DiffViewer } from './DiffViewer'

type Outcome = { kind: 'kept' } | { kind: 'undone'; paths?: string[] } | { kind: 'conflict'; files: string[] } | { kind: 'unavailable' }

export function DiffCard({ run }: { run: RunBlock }) {
  const files = run.files ?? []
  const [outcome, setOutcome] = useState<Outcome>()
  const [undoneFiles, setUndoneFiles] = useState<string[]>([])
  const [patch, setPatch] = useState<string>()

  if (!files.length) return null

  async function undo(paths?: string[]) {
    const r = await window.time.undo(run.runId, paths)
    if (r.ok) {
      if (paths) setUndoneFiles(u => [...u, ...paths])
      else setOutcome({ kind: 'undone' })
    } else setOutcome(r.conflicts.length ? { kind: 'conflict', files: r.conflicts } : { kind: 'unavailable' })
  }

  const done = outcome?.kind === 'kept' || outcome?.kind === 'undone'
  return (
    <div className="diff">
      <b>{files.length} {files.length === 1 ? 'arquivo alterado' : 'arquivos alterados'}</b>
      {files.map(f => (
        <div className="f" key={f.path}>
          <span className={undoneFiles.includes(f.path) || outcome?.kind === 'undone' ? 'struck' : ''}>{f.status} {f.path}</span>
          <span>
            <em>+{f.added}</em><u>−{f.removed}</u>
            {!done && !undoneFiles.includes(f.path) && <button className="link" onClick={() => void undo([f.path])}>desfazer</button>}
          </span>
        </div>
      ))}
      {!done && (
        <div className="acts">
          <button className="primary" onClick={() => setOutcome({ kind: 'kept' })}>Manter tudo</button>
          <button onClick={async () => setPatch(await window.time.patch(run.runId))}>Ver diff</button>
          <button onClick={() => void undo()}>Desfazer</button>
        </div>
      )}
      {outcome?.kind === 'kept' && <div className="note">Mantido.</div>}
      {outcome?.kind === 'undone' && <div className="note">Desfeito. Suas edições feitas durante o pedido foram preservadas.</div>}
      {outcome?.kind === 'conflict' && <div className="note err">Não desfiz nada: você editou os mesmos trechos em {outcome.files.join(', ')}.</div>}
      {outcome?.kind === 'unavailable' && <div className="note err">Pedido interrompido antes do fim; desfazer indisponível.</div>}
      {patch !== undefined && <DiffViewer patch={patch} onClose={() => setPatch(undefined)} />}
    </div>
  )
}
