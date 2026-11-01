import { useEffect, useState } from 'react'
import type { ToolKind } from '@shared/agents'
import { PROVIDERS, type ProfileAgent, type ProviderId, type Transport } from '@shared/profiles'

export const TOOLS: { id: ToolKind; nome: string }[] = [
  { id: 'claude', nome: 'Claude Code' }, { id: 'codex', nome: 'Codex' }, { id: 'gemini', nome: 'Antigravity' }, { id: 'opencode', nome: 'opencode' },
]
const CLI_MODELS: Record<ToolKind, string[]> = {
  claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], codex: [], gemini: [], opencode: ['opencode/big-pickle'],
}

/** Modelos sugeridos: os do provedor (pelo opencode) ou os das CLIs. Campo livre: o Natan pode digitar outro. */
export function useModels(t: Transport | undefined): string[] {
  const [models, setModels] = useState<string[]>([])
  const provider = t?.kind === 'api' ? t.provider : undefined
  useEffect(() => {
    if (!provider) return
    let alive = true
    void window.time.providerModels(provider).then(ms => { if (alive) setModels(ms.map(m => m.id)) }, () => {})
    return () => { alive = false }
  }, [provider])
  return t?.kind === 'cli' ? CLI_MODELS[t.tool] : provider ? models : []
}

/** Transporte + ferramenta/provedor + modelo (usado no agente e na configuração geral do perfil). */
export function TransportFields({ transport, model, inherit, disabled, onChange, listId }: {
  transport?: Transport; model?: string; inherit: boolean; disabled?: boolean; listId: string
  onChange(t: Transport | undefined, model: string | undefined): void
}) {
  const models = useModels(transport)
  const kind = transport?.kind ?? 'inherit'
  return (
    <div className="opt-line wrap">
      <label>Transporte{' '}
        <select aria-label="Transporte" value={kind} disabled={disabled} onChange={e => {
          const k = e.target.value
          if (k === 'inherit') onChange(undefined, undefined)
          else if (k === 'cli') onChange({ kind: 'cli', tool: 'claude' }, undefined)
          else onChange({ kind: 'api', provider: 'openrouter' }, undefined)
        }}>
          {inherit && <option value="inherit">Herdar do perfil</option>}
          <option value="cli">CLI (assinatura)</option>
          <option value="api">API (chave)</option>
        </select>
      </label>
      {transport?.kind === 'cli' && (
        <label>Ferramenta{' '}
          <select aria-label="Ferramenta" value={transport.tool} disabled={disabled} onChange={e => onChange({ kind: 'cli', tool: e.target.value as ToolKind }, undefined)}>
            {TOOLS.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </label>
      )}
      {transport?.kind === 'api' && (
        <label>Provedor{' '}
          <select aria-label="Provedor" value={transport.provider} disabled={disabled} onChange={e => onChange({ kind: 'api', provider: e.target.value as ProviderId }, undefined)}>
            {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
      )}
      {transport && (
        <label>Modelo{' '}
          <input aria-label="Modelo" list={listId} value={model ?? ''} disabled={disabled} placeholder={transport.kind === 'api' ? 'escolha o modelo' : 'padrão da ferramenta'}
            onChange={e => onChange(transport, e.target.value || undefined)} />
          <datalist id={listId}>{models.map(m => <option key={m} value={m} />)}</datalist>
        </label>
      )}
    </div>
  )
}

export function AgentForm({ agent, disabled, inheritsApi, onChange, onRemove }: {
  agent: ProfileAgent; disabled?: boolean; inheritsApi: boolean
  onChange(a: ProfileAgent): void; onRemove?(): void
}) {
  const set = (p: Partial<ProfileAgent>) => onChange({ ...agent, ...p })
  const api = agent.transport ? agent.transport.kind === 'api' : inheritsApi
  return (
    <div className="agent-form">
      <div className="opt-line wrap">
        <label>Nome <input aria-label="Nome" value={agent.nome} maxLength={40} disabled={disabled} onChange={e => set({ nome: e.target.value })} /></label>
        <label>Função <input aria-label="Função" value={agent.funcao} maxLength={200} disabled={disabled} placeholder="ex.: Back-end, APIs, testes" onChange={e => set({ funcao: e.target.value })} /></label>
        {onRemove && !disabled && <button className="link" onClick={onRemove}>Remover</button>}
      </div>
      <label className="block">Prompt
        <textarea aria-label="Prompt" rows={3} value={agent.prompt} maxLength={8000} disabled={disabled} placeholder="Quem é este agente e como ele trabalha"
          onChange={e => set({ prompt: e.target.value })} />
      </label>
      <TransportFields transport={agent.transport} model={agent.model} inherit disabled={disabled} listId={`models-${agent.id}`}
        onChange={(transport, model) => onChange({ ...agent, transport, model })} />
      {api && <p className="paid-note">Usa a sua chave: cada pedido é cobrado pelo provedor.</p>}
      <div className="opt-line wrap">
        <label><input type="checkbox" aria-label="Só lê" checked={agent.readOnly} disabled={disabled}
          onChange={e => set({ readOnly: e.target.checked, ...(e.target.checked ? {} : { consultable: false }) })} /> Só lê</label>
        <label><input type="checkbox" aria-label="Revisa o trabalho" checked={agent.reviewer} disabled={disabled} onChange={e => set({ reviewer: e.target.checked })} /> Revisa o trabalho</label>
        <label><input type="checkbox" aria-label="Pode ser consultado" checked={agent.consultable} disabled={disabled || !agent.readOnly}
          onChange={e => set({ consultable: e.target.checked })} /> Pode ser consultado</label>
      </div>
    </div>
  )
}
