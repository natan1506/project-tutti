import { useEffect, useState } from 'react'
import type { UsageSource } from '@shared/usage'
import { formatTokens } from '../state/format'
import { useUsageStore } from '../state/usageStore'
import { UsageDetail } from './UsageDetail'

export const TOOL_NAME: Record<UsageSource, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Antigravity', opencode: 'opencode', api: 'API (paga)' }
/** Cor do primeiro agente do perfil que usa a ferramenta. */
export const TOOL_COLOR: Record<UsageSource, string> = { claude: '#d97757', codex: '#3d6df2', gemini: '#8a7cf0', opencode: '#b9b9c2', api: '#f5a524' }

const readCollapsed = () => { try { return localStorage.getItem('usagePanel.collapsed') === '1' } catch { return false } }

/** Spec custos-e-perfis §4: uso de cada assinatura, fixo no canto inferior direito do palco. */
export function UsagePanel() {
  const { snapshot, setSnapshot } = useUsageStore()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [detail, setDetail] = useState(false)
  useEffect(() => {
    void window.time.usageSnapshot().then(setSnapshot)
    return window.time.onUsage(setSnapshot)
  }, [setSnapshot])
  const toggle = () => setCollapsed(c => { try { localStorage.setItem('usagePanel.collapsed', c ? '0' : '1') } catch { /* sem storage */ } return !c })
  const rows = snapshot?.rows ?? []
  const anyAlert = rows.some(r => r.alert)
  return (
    <div className={`usage-panel ${anyAlert ? 'has-alert' : ''}`}>
      <div className="usage-head">
        <button className="link" onClick={() => setDetail(true)}>Uso</button>
        <button className="link" onClick={toggle} aria-label={collapsed ? 'Abrir' : 'Recolher'}>{collapsed ? '▴' : '▾'}</button>
      </div>
      {!collapsed && rows.map(r => (
        <div key={r.tool} className={`usage-row ${r.alert ? 'alert' : ''}`} data-tool={r.tool} onClick={() => setDetail(true)}>
          <div className="usage-line">
            <span className="usage-name">{TOOL_NAME[r.tool]}</span>
            <span className="usage-pct">{r.utilization === null ? '—' : `${r.utilization}%`}{r.estimated && <em> estimado</em>}</span>
          </div>
          {r.utilization !== null && (
            <div className="usage-bar"><i style={{ width: `${Math.min(100, r.utilization)}%`, background: r.alert ? '#f87171' : TOOL_COLOR[r.tool] }} /></div>
          )}
          <div className="usage-tokens">↑ {formatTokens(r.tokens.input)} ↓ {formatTokens(r.tokens.output)}</div>
        </div>
      ))}
      {detail && <UsageDetail onClose={() => setDetail(false)} />}
    </div>
  )
}
