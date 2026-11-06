import { ArrowLeft, Hand, RotateCw, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AGENTS, getAgent } from '@shared/agents'
import { useBrowserStore } from '../state/browserStore'
import { agentColor } from '../stage/colors'

const OVER_PAGE = '.menu, .modal-bg, .usage-detail'
const known = new Set(AGENTS.map(a => a.id))

function withScheme(raw: string): string {
  const t = raw.trim()
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`
}

/**
 * A página é uma vista nativa sobre a janela: este componente só diz onde ela fica.
 * Nada do DOM consegue aparecer por cima dela, então menus e modais a escondem enquanto estão abertos.
 */
function usePageSlot(hasPage: boolean) {
  const slot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = slot.current
    if (!hasPage || !el) { void window.time.browserBounds(null); return }
    const sync = () => {
      const r = el.getBoundingClientRect()
      const covered = !!document.querySelector(OVER_PAGE)
      void window.time.browserBounds(covered || r.width <= 0 || r.height <= 0 ? null : { x: r.left, y: r.top, width: r.width, height: r.height })
    }
    let last = ''
    const syncIfChanged = () => {
      const r = el.getBoundingClientRect()
      const key = `${!!document.querySelector(OVER_PAGE)}|${r.left}|${r.top}|${r.width}|${r.height}`
      if (key !== last) { last = key; sync() }
    }
    sync()
    const ro = new ResizeObserver(syncIfChanged)
    ro.observe(el)
    const mo = new MutationObserver(syncIfChanged)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', syncIfChanged)
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', syncIfChanged)
      void window.time.browserBounds(null)
    }
  }, [hasPage])
  return slot
}

export function BrowserPanel() {
  const { tabs, active, control } = useBrowserStore()
  const current = tabs.find(t => t.agentId === active)
  const inControl = !!current && control === current.agentId
  const slot = usePageSlot(!!current)
  const [draft, setDraft] = useState<string>()
  useEffect(() => setDraft(undefined), [current?.url, inControl])

  if (!current) {
    return (
      <div className="browser-panel empty">
        <p><b>Nenhum agente abriu uma página ainda.</b></p>
        <p>Quando Bússola, Forja ou Pincel usarem o navegador, a página aparece aqui ao vivo, e você pode assumir quando quiser.</p>
      </div>
    )
  }
  const go = () => { if (draft?.trim()) void window.time.browserNavigate(withScheme(draft)) }
  return (
    <div className={`browser-panel ${inControl ? 'in-control' : ''}`}>
      <div className="browser-tabs" role="tablist">
        {tabs.filter(t => known.has(t.agentId)).map(t => {
          const a = getAgent(t.agentId)
          return (
            <span key={t.agentId} className={`browser-tab ${t.agentId === active ? 'on' : ''}`}>
              <button role="tab" aria-selected={t.agentId === active} title={t.title || t.url} onClick={() => void window.time.browserSelect(t.agentId)}>
                <i style={{ background: agentColor(a) }} />{a.nome}{control === t.agentId && <em>você</em>}
              </button>
              <button className="browser-close" aria-label={`Fechar a aba de ${a.nome}`} onClick={() => void window.time.browserClose(t.agentId)}><X size={12} /></button>
            </span>
          )
        })}
      </div>
      <div className="browser-bar">
        <button className="icon" aria-label="Voltar" disabled={!inControl} onClick={() => void window.time.browserBack()}><ArrowLeft size={14} /></button>
        <button className="icon" aria-label="Recarregar" disabled={!inControl} onClick={() => void window.time.browserReload()}><RotateCw size={14} className={current.loading ? 'spin' : ''} /></button>
        <input aria-label="Endereço" readOnly={!inControl} value={draft ?? current.url} spellCheck={false}
          onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} />
        {inControl
          ? <button className="browser-mode on" onClick={() => void window.time.browserRelease()}><Undo2 size={14} /> Devolver</button>
          : <button className="browser-mode" onClick={() => void window.time.browserTakeover(current.agentId)}><Hand size={14} /> Assumir</button>}
      </div>
      <div className="browser-note">{inControl ? 'Você está no controle: o agente espera até você devolver.' : `Assistindo ${getAgent(current.agentId).nome}. Para clicar ou digitar, assuma.`}</div>
      <div className="browser-slot" ref={slot} />
    </div>
  )
}
