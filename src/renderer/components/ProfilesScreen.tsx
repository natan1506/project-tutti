import { useState } from 'react'
import { MAX_AGENTS, validateProfile, type Profile, type ProfileAgent } from '@shared/profiles'
import { useProfileStore } from '../state/profileStore'
import { useRunStore } from '../state/runStore'
import { AgentForm, TransportFields } from './AgentForm'
import { KeysSection } from './KeysSection'

// Tela de perfis (spec custos-e-perfis §6): o Padrão só se duplica; os do Natan se criam do zero.

let seq = 0
const blankAgent = (): ProfileAgent => ({ id: `novo_${++seq}`, nome: '', prompt: '', funcao: '', readOnly: false, reviewer: false, consultable: false })
const blankProfile = (): Profile => ({ id: '', nome: 'Novo perfil', builtin: false, defaults: { transport: { kind: 'cli', tool: 'claude' } }, agents: [blankAgent()] })

export function ProfilesScreen() {
  const { profiles, active, openConfig, load } = useProfileStore()
  const project = useRunStore(s => s.project)
  const [selected, setSelected] = useState<string>(active.id)
  const [draft, setDraft] = useState<Profile>()
  const [errors, setErrors] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)

  const current = draft ?? profiles.find(p => p.id === selected) ?? profiles[0]
  const readOnly = current.builtin
  const edit = (p: Partial<Profile>) => { setDraft({ ...current, ...p }); setErrors([]) }
  const pick = (id: string) => { setSelected(id); setDraft(undefined); setErrors([]); setConfirmDelete(false) }
  const writers = current.agents.filter(a => !a.readOnly)

  async function save() {
    const v = validateProfile(current)
    if (!v.ok) { setErrors(v.errors); return }
    const r = await window.time.saveProfile(current)
    if (!r.ok) { setErrors(r.errors); return }
    setDraft(undefined)
    setSelected(r.profile.id)
    if (project) await load(project.id)
  }

  async function duplicate() {
    const copy = await window.time.duplicateProfile(current.id, undefined)
    setDraft(undefined)
    setSelected(copy.id)
  }

  async function remove() {
    await window.time.deleteProfile(current.id)
    setConfirmDelete(false)
    pick('padrao')
    if (project) await load(project.id)
  }

  return (
    <div className="modal-bg" onClick={() => openConfig(false)}>
      <div className="modal profiles" onClick={e => e.stopPropagation()}>
        <div className="row between"><b>Perfis</b><button onClick={() => openConfig(false)}>Fechar</button></div>
        <div className="profiles-body">
          <aside className="profiles-list">
            {profiles.map(p => (
              <button key={p.id} className={!draft && p.id === current.id ? 'on' : ''} onClick={() => pick(p.id)}>{p.nome}</button>
            ))}
            {draft && !draft.id && <button className="on">{draft.nome || 'Sem nome'} (não salvo)</button>}
            <button className="menu-action" onClick={() => { setDraft(blankProfile()); setErrors([]) }}>Novo perfil</button>
          </aside>
          <section className="profile-edit">
            <div className="opt-line wrap">
              <label>Nome do perfil{' '}
                <input aria-label="Nome do perfil" value={current.nome} maxLength={60} disabled={readOnly} onChange={e => edit({ nome: e.target.value })} />
              </label>
              {readOnly && <span className="badge">Padrão · só leitura</span>}
              {(readOnly || current.id) && <button onClick={() => void duplicate()}>Duplicar</button>}
            </div>
            <h4>Configuração geral</h4>
            <TransportFields transport={current.defaults.transport} model={current.defaults.model} inherit={false} disabled={readOnly} listId="models-geral"
              onChange={(t, model) => edit({ defaults: { transport: t ?? current.defaults.transport, ...(model ? { model } : {}) } })} />
            <div className="opt-line">
              <label>Coordenador{' '}
                <select aria-label="Coordenador" value={current.coordinatorId ?? ''} disabled={readOnly}
                  onChange={e => edit({ coordinatorId: e.target.value || undefined })}>
                  <option value="">Nenhum — só pedidos diretos</option>
                  {writers.map(a => <option key={a.id} value={a.id}>{a.nome || '(sem nome)'}</option>)}
                </select>
              </label>
            </div>
            <h4>Agentes</h4>
            {current.agents.map((a, i) => (
              <AgentForm key={a.id} agent={a} disabled={readOnly} inheritsApi={current.defaults.transport.kind === 'api'}
                onChange={next => edit({ agents: current.agents.map((x, j) => (j === i ? next : x)) })}
                {...(current.agents.length > 1 ? { onRemove: () => edit({
                  agents: current.agents.filter((_, j) => j !== i),
                  ...(current.coordinatorId === a.id ? { coordinatorId: undefined } : {}),
                }) } : {})} />
            ))}
            {!readOnly && current.agents.length < MAX_AGENTS && (
              <button className="link" onClick={() => edit({ agents: [...current.agents, blankAgent()] })}>Adicionar agente</button>
            )}
            {errors.length > 0 && <ul className="err">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
            {!readOnly && (
              <div className="row">
                <button className="primary" onClick={() => void save()}>Salvar perfil</button>
                {current.id && !confirmDelete && <button onClick={() => setConfirmDelete(true)}>Apagar perfil</button>}
                {confirmDelete && (
                  <span className="confirm">
                    Apagar o perfil {current.nome}? Conversas antigas continuam abrindo.{' '}
                    <button className="danger" onClick={() => void remove()}>Apagar</button>
                    <button onClick={() => setConfirmDelete(false)}>Voltar</button>
                  </span>
                )}
              </div>
            )}
          </section>
        </div>
        <KeysSection onChange={() => { if (project) void load(project.id) }} />
      </div>
    </div>
  )
}
