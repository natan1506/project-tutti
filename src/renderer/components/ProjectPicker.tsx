import { ChevronDown, FolderOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDismiss } from './useDismiss'
import type { Project } from '@shared/models'
import { useRunStore } from '../state/runStore'

export function ProjectPicker() {
  const project = useRunStore(s => s.project)
  const setProject = useRunStore(s => s.setProject)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useDismiss(wrap, open, () => setOpen(false))
  const [recent, setRecent] = useState<Project[]>([])

  useEffect(() => { if (open) void window.time.recentProjects().then(setRecent) }, [open])

  async function choose(path: string) {
    setOpen(false)
    const { project: p } = await window.time.openProject(path)
    await setProject(p)
  }

  return (
    <div className="proj-wrap" ref={wrap}>
      <button className="proj" title={project?.path.replace(/^\/Users\/[^/]+/, '~')} onClick={() => setOpen(o => !o)}>
        <FolderOpen size={15} strokeWidth={1.8} aria-hidden /> <span className="proj-name">{project ? project.name : 'Abrir projeto'}</span> <ChevronDown size={14} className="caret" aria-hidden />
      </button>
      {open && (
        <div className="menu">
          {recent.map(p => <button key={p.id} onClick={() => void choose(p.path)}>{p.name}<small>{p.path}</small></button>)}
          <button className="menu-action" onClick={async () => { const p = await window.time.pickFolder(); if (p) await choose(p); else setOpen(false) }}>
            Abrir pasta…
          </button>
        </div>
      )}
    </div>
  )
}
