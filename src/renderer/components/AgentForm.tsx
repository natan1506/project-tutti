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
      <label>Como roda{' '}
        <select aria-label="Transporte" value={kind} disabled={disabled} onChange={e => {
          const k = e.target.value
          if (k === 'inherit') onChange(undefined, undefined)
          else if (k === 'cli') onChange({ kind: 'cli', tool: 'claude' }, undefined)
          else onChange({ kind: 'api', provider: 'openrouter' }, undefined)
        }}>
          {inherit && <option value="inherit">Igual ao perfil</option>}
          <option value="cli">Assinatura (ferramenta logada)</option>
          <option value="api">Chave de API (pago por uso)</option>
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

export function AgentForm({ agent, disabled, inheritsApi, color, onChange, onRemove, onCollapse }: {
  agent: ProfileAgent; disabled?: boolean; inheritsApi: boolean; color?: string
  onChange(a: ProfileAgent): void; onRemove?(): void; onCollapse?(): void
}) {
  const set = (p: Partial<ProfileAgent>) => onChange({ ...agent, ...p })
  const api = agent.transport ? agent.transport.kind === 'api' : inheritsApi
  return (
    <div className="agent-form">
      <div className="agent-form-head">
        <i className="agent-dot" style={{ background: color ?? '#8e8bb5' }} />
        <b>{agent.nome || 'Novo agente'}</b>
        <span className="grow" />
        {onRemove && !disabled && <button className="link danger-link" onClick={onRemove}>Remover</button>}
        {onCollapse && <button onClick={onCollapse}>{disabled ? 'Fechar' : 'Pronto'}</button>}
      </div>
      <div className="form-grid">
        <label className="block">Nome <input aria-label="Nome" value={agent.nome} maxLength={40} disabled={disabled} placeholder="ex.: Forja" onChange={e => set({ nome: e.target.value })} /></label>
        <label className="block">Função <input aria-label="Função" value={agent.funcao} maxLength={200} disabled={disabled} placeholder="ex.: Back-end, APIs, testes" onChange={e => set({ funcao: e.target.value })} />
          <small>Uma linha. O coordenador usa para decidir quem faz o quê.</small></label>
      </div>
      <label className="block">Prompt
        <textarea aria-label="Prompt" rows={4} value={agent.prompt} maxLength={8000} disabled={disabled} placeholder="Quem é este agente, como ele trabalha e o que evita"
          onChange={e => set({ prompt: e.target.value })} />
      </label>
      <TransportFields transport={agent.transport} model={agent.model} inherit disabled={disabled} listId={`models-${agent.id}`}
        onChange={(transport, model) => onChange({ ...agent, transport, model })} />
      {api && <p className="paid-note">Usa a sua chave: cada pedido é cobrado pelo provedor.</p>}
      <div className="roles">
        <label title="Não edita arquivos nem roda comandos que mudam o projeto"><input type="checkbox" aria-label="Só lê" checked={agent.readOnly} disabled={disabled}
          onChange={e => set({ readOnly: e.target.checked, ...(e.target.checked ? {} : { consultable: false }) })} /> Só lê</label>
        <label title="Entra no fim de um pedido do Time para revisar o que os outros fizeram"><input type="checkbox" aria-label="Revisa o trabalho" checked={agent.reviewer} disabled={disabled} onChange={e => set({ reviewer: e.target.checked })} /> Revisa o trabalho</label>
        <label title="Outros agentes podem fazer perguntas a ele no meio do trabalho (só para quem só lê)"><input type="checkbox" aria-label="Pode ser consultado" checked={agent.consultable} disabled={disabled || !agent.readOnly}
          onChange={e => set({ consultable: e.target.checked })} /> Pode ser consultado</label>
      </div>
    </div>
  )
}
