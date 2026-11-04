import { Building2, Theater } from 'lucide-react'
import { useViewStore } from '../state/viewStore'

/** Palco | Escritório: o mesmo time, duas formas de ver (design §7.1). */
export function ViewToggle() {
  const { view, setView } = useViewStore()
  return (
    <span className="autonomy view-toggle" role="group" aria-label="Visualização">
      <button className={view === 'palco' ? 'on' : ''} aria-pressed={view === 'palco'} onClick={() => setView('palco')}><Theater size={14} /> Palco</button>
      <button className={view === 'escritorio' ? 'on' : ''} aria-pressed={view === 'escritorio'} onClick={() => setView('escritorio')}><Building2 size={14} /> Escritório</button>
    </span>
  )
}
