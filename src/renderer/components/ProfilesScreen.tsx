import { useState } from 'react'
import { MAX_AGENTS, providerName, resolveAgentDefs, validateProfile, type Profile, type ProfileAgent, type Transport } from '@shared/profiles'
import { useProfileStore } from '../state/profileStore'
import { useRunStore } from '../state/runStore'
import { agentColor } from '../stage/colors'
import { AgentForm, TOOLS, TransportFields } from './AgentForm'
import { KeysSection } from './KeysSection'

// Tela de perfis (spec custos-e-perfis §6): o Padrão só se duplica; os do Natan se criam do zero.

let seq = 0
const blankAgent = (): ProfileAgent => ({ id: `novo_${++seq}`, nome: '', prompt: '', funcao: '', readOnly: false, reviewer: false, consultable: false })
const blankProfile = (): Profile => ({ id: '', nome: 'Novo perfil', builtin: false, defaults: { transport: { kind: 'cli', tool: 'claude' } }, agents: [blankAgent()] })
const transportName = (t: Transport) => t.kind === 'cli' ? TOOLS.find(x => x.id === t.tool)?.nome ?? t.tool : providerName(t.provider)

/** Cartão resumido de um agente: cor, nome, função, onde roda e papéis. */
function AgentCard({ agent, profile, color, readOnly, onEdit }: { agent: ProfileAgent; profile: Profile; color: string; readOnly: boolean; onEdit(): void }) {
  const t = agent.transport ?? profile.defaults.transport
  const model = agent.model ?? (agent.transport ? undefined : profile.defaults.model)
  const roles = [profile.coordinatorId === agent.id && 'Coordena', agent.readOnly && 'Só lê', agent.reviewer && 'Revisa', agent.consultable && 'Consultável'].filter(Boolean) as string[]
  return (
    <div className="agent-card">
      <i className="agent-dot" style={{ background: color }} />
      <div className="agent-card-main">
        <div className="agent-card-top"><b>{agent.nome || '(sem nome)'}</b>{roles.map(r => <span key={r} className="role">{r}</span>)}</div>
        <div className="agent-card-sub">{agent.funcao || 'Sem função descrita'}</div>
      </div>
      <div className="agent-card-run">
        <span className={t.kind === 'api' ? 'run-tag paid-tag' : 'run-tag'}>{transportName(t)}</span>
        {model && <small>{model}</small>}
      </div>
      <button onClick={onEdit}>{readOnly ? 'Ver' : 'Editar'}</button>
    </div>
  )
}

export function ProfilesScreen() {
  const { profiles, active, openConfig, load } = useProfileStore()
  const project = useRunStore(s => s.project)
  const [selected, setSelected] = useState<string>(active.id)
  const [draft, setDraft] = useState<Profile>()
  const [errors, setErrors] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  const current = draft ?? profiles.find(p => p.id === selected) ?? profiles[0]
  const readOnly = current.builtin
  const edit = (p: Partial<Profile>) => { setDraft({ ...current, ...p }); setErrors([]) }
  const pick = (id: string) => { setSelected(id); setDraft(undefined); setErrors([]); setConfirmDelete(false); setOpenIds(new Set()) }
  const writers = current.agents.filter(a => !a.readOnly)
  const colors = new Map(resolveAgentDefs(current).map(d => [d.id, agentColor(d)]))
  const toggle = (id: string) => setOpenIds(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const startNew = () => { const p = blankProfile(); setDraft(p); setErrors([]); setOpenIds(new Set(p.agents.map(a => a.id))) }
  const addAgent = () => { const a = blankAgent(); edit({ agents: [...current.agents, a] }); setOpenIds(s => new Set(s).add(a.id)) }
  const discard = () => { setDraft(undefined); setErrors([]); setOpenIds(new Set()) }

  async function save() {
    const v = validateProfile(current)
    if (!v.ok) { setErrors(v.errors); return }
    const r = await window.time.saveProfile(current)
    if (!r.ok) { setErrors(r.errors); return }
    setDraft(undefined)
    setSelected(r.profile.id)
    setOpenIds(new Set())
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
              <button key={p.id} className={!(draft && !draft.id) && p.id === current.id ? 'on' : ''} onClick={() => pick(p.id)}>
                {p.nome}<small>{p.builtin ? 'pronto · só leitura' : `${p.agents.length} ${p.agents.length === 1 ? 'agente' : 'agentes'}`}</small>
              </button>
            ))}
            {draft && !draft.id && <button className="on">{draft.nome || 'Sem nome'}<small>não salvo</small></button>}
            <button className="menu-action" onClick={startNew}>Novo perfil</button>
            <p className="list-help">Um perfil é o time que trabalha no projeto: quem são os agentes, o que cada um faz e onde roda.</p>
          </aside>
          <section className="profile-edit">
            <div className="profile-head">
              <input className="profile-name" aria-label="Nome do perfil" value={current.nome} maxLength={60} disabled={readOnly} onChange={e => edit({ nome: e.target.value })} />
              {readOnly && <span className="badge">Padrão · só leitura</span>}
              <span className="grow" />
              {(readOnly || current.id) && <button onClick={() => void duplicate()} title="Cria uma cópia editável">Duplicar</button>}
              {!readOnly && current.id && !confirmDelete && <button onClick={() => setConfirmDelete(true)}>Apagar perfil</button>}
            </div>
            {confirmDelete && (
              <div className="confirm">
                Apagar o perfil {current.nome}? Conversas antigas continuam abrindo.{' '}
                <button className="danger" onClick={() => void remove()}>Apagar</button>
                <button onClick={() => setConfirmDelete(false)}>Voltar</button>
              </div>
            )}
            {readOnly && <p className="section-help">O Padrão vem com o Tutti e não muda. Duplique para criar um time seu a partir dele.</p>}

            <h4>Onde os agentes rodam</h4>
            <p className="section-help">Vale para todos os agentes, a não ser que um deles escolha outro. <b>Assinatura</b> usa as ferramentas já logadas no seu Mac, sem custo extra; <b>Chave de API</b> é cobrada por uso no provedor.</p>
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
              <span className="field-help">Quem recebe os pedidos para o Time e decide quem faz o quê.</span>
            </div>

            <h4>Agentes <span className="count">{current.agents.length} de {MAX_AGENTS}</span></h4>
            <div className="agent-list">
              {current.agents.map((a, i) => openIds.has(a.id) ? (
                <AgentForm key={a.id} agent={a} disabled={readOnly} inheritsApi={current.defaults.transport.kind === 'api'}
                  color={colors.get(a.id)} onCollapse={() => toggle(a.id)}
                  onChange={next => edit({ agents: current.agents.map((x, j) => (j === i ? next : x)) })}
                  {...(current.agents.length > 1 ? { onRemove: () => edit({
                    agents: current.agents.filter((_, j) => j !== i),
                    ...(current.coordinatorId === a.id ? { coordinatorId: undefined } : {}),
                  }) } : {})} />
              ) : (
                <AgentCard key={a.id} agent={a} profile={current} color={colors.get(a.id) ?? '#8e8bb5'} readOnly={readOnly} onEdit={() => toggle(a.id)} />
              ))}
            </div>
            {!readOnly && current.agents.length < MAX_AGENTS && (
              <button className="add-agent" onClick={addAgent}>Adicionar agente</button>
            )}
          </section>
        </div>
        {!readOnly && (
          <div className="profile-footer">
            {errors.length > 0 ? <ul className="err">{errors.map(e => <li key={e}>{e}</li>)}</ul>
              : <span className="dirty">{draft ? 'Alterações não salvas' : ''}</span>}
            <span className="grow" />
            {draft && <button onClick={discard}>Descartar</button>}
            <button className="primary" disabled={!draft} onClick={() => void save()}>Salvar perfil</button>
          </div>
        )}
        <KeysSection onChange={() => { if (project) void load(project.id) }} />
      </div>
    </div>
  )
}
