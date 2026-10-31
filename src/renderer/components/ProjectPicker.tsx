import { useEffect, useState } from 'react'
import type { Project } from '@shared/models'
import { useRunStore } from '../state/runStore'

export function ProjectPicker() {
  const project = useRunStore(s => s.project)
  const setProject = useRunStore(s => s.setProject)
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<Project[]>([])
  const [askGit, setAskGit] = useState<string>()

  useEffect(() => { if (open) void window.time.recentProjects().then(setRecent) }, [open])

  async function choose(path: string) {
    setOpen(false)
    const { project: p, isGitRepo } = await window.time.openProject(path)
    if (isGitRepo) await setProject(p)
    else setAskGit(p.path)
  }

  async function initGit() {
    const path = askGit!
    setAskGit(undefined)
    await window.time.initGit(path)
    await choose(path)
  }

  return (
    <div className="proj-wrap">
      <button className="proj" onClick={() => setOpen(o => !o)}>
        📁 <code>{project ? project.path.replace(/^\/Users\/[^/]+/, '~') : 'Sem projeto'}</code> ▾
      </button>
      {open && (
        <div className="menu">
          {recent.map(p => <button key={p.id} onClick={() => void choose(p.path)}>{p.name}<small>{p.path}</small></button>)}
          <button className="menu-action" onClick={async () => { const p = await window.time.pickFolder(); if (p) await choose(p); else setOpen(false) }}>
            Abrir pasta…
          </button>
        </div>
      )}
      {askGit && (
        <div className="modal-bg">
          <div className="modal">
            <p>Esta pasta não usa git. Posso iniciar um repositório para permitir desfazer?</p>
            <div className="row">
              <button className="primary" onClick={() => void initGit()}>Iniciar git</button>
              <button onClick={() => setAskGit(undefined)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
