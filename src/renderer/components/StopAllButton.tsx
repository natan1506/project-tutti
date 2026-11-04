import { Square } from 'lucide-react'
import { useEffect, useState } from 'react'

/** Parar tudo (design §5): todos os pedidos de todos os projetos, sem confirmação; atalho ⌘ + . */
export function StopAllButton() {
  const [active, setActive] = useState(0)

  useEffect(() => {
    void window.time.activity().then(setActive)
    return window.time.onActivity(setActive)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === '.' && active > 0) { e.preventDefault(); void window.time.stopAll() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  return (
    <button className="stop-all" disabled={active === 0} title="Parar tudo (⌘ + .)" onClick={() => void window.time.stopAll()}>
      <Square size={12} fill="currentColor" strokeWidth={0} /> Parar tudo
    </button>
  )
}
