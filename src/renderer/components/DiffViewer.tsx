export function DiffViewer({ patch, onClose }: { patch: string; onClose: () => void }) {
  const lineClass = (l: string) =>
    l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') ? 'h' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal diff-viewer" onClick={e => e.stopPropagation()}>
        <div className="row between"><b>Diff</b><button onClick={onClose}>Fechar</button></div>
        <pre>{patch.split('\n').map((l, i) => <div key={i} className={lineClass(l)}>{l || ' '}</div>)}</pre>
      </div>
    </div>
  )
}
