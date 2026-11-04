import { useEffect, useRef } from 'react'
import { applySideWidth, clampSideWidth, loadSideWidth, saveSideWidth, SIDE_DEFAULT } from '../state/sideWidth'

/** Borda arrastável do painel do chat: arrastar muda a largura; duplo clique volta ao padrão. */
export function SideResizer() {
  const width = useRef(loadSideWidth(window.innerWidth))

  useEffect(() => {
    applySideWidth(width.current)
    const onResize = () => { width.current = clampSideWidth(width.current, window.innerWidth); applySideWidth(width.current) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function start(e: React.MouseEvent) {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = width.current
    document.body.classList.add('resizing')
    const move = (ev: MouseEvent) => {
      width.current = clampSideWidth(w0 + (x0 - ev.clientX), window.innerWidth)
      applySideWidth(width.current)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('resizing')
      saveSideWidth(width.current)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function reset() {
    width.current = SIDE_DEFAULT
    applySideWidth(SIDE_DEFAULT)
    saveSideWidth(SIDE_DEFAULT)
  }

  return <div className="side-resizer" role="separator" aria-orientation="vertical" aria-label="Largura do chat"
    title="Arraste para mudar a largura · duplo clique volta ao padrão" onMouseDown={start} onDoubleClick={reset} />
}
