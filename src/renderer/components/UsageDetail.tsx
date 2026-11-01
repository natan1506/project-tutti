import { useEffect, useState } from 'react'
import { getAgent, type ToolKind } from '@shared/agents'
import type { UsageDetail as Detail, UsageSettings } from '@shared/usage'
import { formatTokens } from '../state/format'
import { useRunStore } from '../state/runStore'
import { TOOL_NAME } from './UsagePanel'

const TOOLS: ToolKind[] = ['claude', 'codex', 'gemini', 'opencode']

/** Detalhe do uso: por agente e pedido da conversa aberta, últimos 7 dias, e os limites de aviso. */
export function UsageDetail({ onClose }: { onClose(): void }) {
  const conversation = useRunStore(s => s.conversation)
  const [detail, setDetail] = useState<Detail>()
  const [settings, setSettings] = useState<UsageSettings>()
  useEffect(() => {
    void window.time.usageDetail(conversation?.id ?? null).then(setDetail)
    void window.time.usageSettings().then(setSettings)
  }, [conversation?.id])
  const save = async (s: Partial<UsageSettings>) => {
    await window.time.updateUsageSettings(s)
    setSettings(await window.time.usageSettings())
  }
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v))
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal usage-detail" onClick={e => e.stopPropagation()}>
        <div className="row between"><b>Uso</b><button onClick={onClose}>Fechar</button></div>
        <h4>Nesta conversa</h4>
        {detail?.byRun.length ? (
          <table><tbody>{detail.byRun.map((r, i) => (
            <tr key={i}><td>{getAgent(r.agentId).nome}</td><td>{TOOL_NAME[r.tool]}</td><td>↑ {formatTokens(r.tokens.input)}</td><td>↓ {formatTokens(r.tokens.output)}</td></tr>
          ))}</tbody></table>
        ) : <p className="note">Nada ainda.</p>}
        <h4>Últimos 7 dias</h4>
        {detail?.byDay.length ? (
          <table><tbody>{detail.byDay.map((d, i) => (
            <tr key={i}><td>{d.day}</td><td>{d.projectPath.split('/').at(-1)}</td><td>{TOOL_NAME[d.tool]}</td><td>↑ {formatTokens(d.tokens.input)}</td><td>↓ {formatTokens(d.tokens.output)}</td></tr>
          ))}</tbody></table>
        ) : <p className="note">Nada ainda.</p>}
        {settings && (
          <>
            <h4>Avisos</h4>
            <label className="opt-line">Avisar em <input type="number" min={1} max={100} defaultValue={settings.alertAt}
              onBlur={e => void save({ alertAt: num(e.target.value) })} />% (geral)</label>
            {TOOLS.map(t => (
              <div key={t} className="opt-line">
                <span>{TOOL_NAME[t]}</span>
                <label>avisar em <input type="number" min={1} max={100} placeholder={String(settings.alertAt)} defaultValue={settings.perTool[t]?.alertAt}
                  data-setting={`alert-${t}`} onBlur={e => void save({ perTool: { [t]: { alertAt: num(e.target.value) } } })} />%</label>
                {t !== 'claude' && t !== 'opencode' && (
                  <label>teto estimado <input type="number" min={1} placeholder="tokens/dia" defaultValue={settings.perTool[t]?.estimateCeilingTokens}
                    onBlur={e => void save({ perTool: { [t]: { estimateCeilingTokens: num(e.target.value) } } })} /></label>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
