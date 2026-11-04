import { useEffect, useState } from 'react'
import { AUTONOMY_LABEL, AUTONOMY_LEVELS, DEFAULT_AUTONOMY, type AutonomyLevel } from '@shared/autonomy'
import { useRunStore } from '../state/runStore'

/** Quanto os agentes fazem sem perguntar neste projeto (design §4.3). Vale já para a próxima ação. */
export function AutonomyPicker() {
  const project = useRunStore(s => s.project)
  const [level, setLevel] = useState<AutonomyLevel>(DEFAULT_AUTONOMY)

  useEffect(() => {
    if (!project) return
    let live = true
    void window.time.autonomy(project.path).then(l => { if (live) setLevel(l) })
    return () => { live = false }
  }, [project])

  async function choose(l: AutonomyLevel) {
    if (!project) return
    setLevel(l)
    await window.time.setAutonomy(project.path, l)
  }

  return (
    <span className="autonomy" role="group" aria-label="Autonomia">
      {AUTONOMY_LEVELS.map(l => (
        <button key={l} disabled={!project} onClick={() => void choose(l)}
          className={[l === level ? 'on' : '', l === 'autonomous' ? 'alert' : ''].filter(Boolean).join(' ')}>
          {AUTONOMY_LABEL[l]}
        </button>
      ))}
    </span>
  )
}
