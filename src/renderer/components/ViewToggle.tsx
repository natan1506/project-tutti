import { Building2, Globe, Theater } from 'lucide-react'
import { useBrowserStore } from '../state/browserStore'
import { hasWebGL } from '../stage/webgl'
import { useViewStore } from '../state/viewStore'

/** Palco | Escritório | Navegador: o mesmo time, formas diferentes de ver (design §7.1). */
export function ViewToggle() {
  const { view, setView } = useViewStore()
  const tabs = useBrowserStore(s => s.tabs.length)
  const webgl = hasWebGL()
  return (
    <span className="autonomy view-toggle" role="group" aria-label="Visualização">
      <button className={view === 'palco' ? 'on' : ''} aria-pressed={view === 'palco'} onClick={() => setView('palco')}><Theater size={14} /> Palco</button>
      {webgl && <button className={view === 'escritorio' ? 'on' : ''} aria-pressed={view === 'escritorio'} onClick={() => setView('escritorio')}><Building2 size={14} /> Escritório</button>}
      <button className={view === 'navegador' ? 'on' : ''} aria-pressed={view === 'navegador'} onClick={() => setView('navegador')}><Globe size={14} /> Navegador{tabs > 0 && <b className="count">{tabs}</b>}</button>
    </span>
  )
}
