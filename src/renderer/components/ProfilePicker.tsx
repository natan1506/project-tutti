import { ChevronDown, UsersRound } from 'lucide-react'
import { useRef, useState } from 'react'
import { useDismiss } from './useDismiss'
import { useProfileStore } from '../state/profileStore'
import { useRunStore } from '../state/runStore'

/** Seletor de perfil ao lado do projeto; cada projeto lembra o seu (spec custos-e-perfis §6). */
export function ProfilePicker() {
  const project = useRunStore(s => s.project)
  const { profiles, active, setActive, openConfig } = useProfileStore()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useDismiss(wrap, open, () => setOpen(false))

  return (
    <div className="proj-wrap" ref={wrap}>
      <button className="prof" onClick={() => setOpen(o => !o)} disabled={!project}><UsersRound size={15} strokeWidth={1.8} aria-hidden /> {active.nome} <ChevronDown size={14} className="caret" aria-hidden /></button>
      {open && project && (
        <div className="menu">
          {profiles.map(p => (
            <button key={p.id} className={p.id === active.id ? 'on' : ''} onClick={() => { setOpen(false); void setActive(project.id, p.id) }}>
              {p.nome}<small>{p.agents.length} agentes{p.coordinatorId ? '' : ' · sem coordenador'}</small>
            </button>
          ))}
          <button className="menu-action" onClick={() => { setOpen(false); openConfig(true) }}>Editar perfis…</button>
        </div>
      )}
    </div>
  )
}
