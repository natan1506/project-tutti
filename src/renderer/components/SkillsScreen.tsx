import { useEffect, useMemo, useState } from 'react'
import type { AgentDef } from '@shared/agents'
import type { SkillRunError } from '@shared/models'
import { isPaidApi, providerName, resolveAgentDefs } from '@shared/profiles'
import { BODY_MAX, type Skill, type SkillDraft } from '@shared/skills'
import { useProfileStore } from '../state/profileStore'
import { useRunStore } from '../state/runStore'
import { useSkillStore } from '../state/skillStore'

// Janela de skills (plano skills): o Natan descreve, um agente escreve, testa e ajusta; depois marca quem usa.

const ERRORS: Record<SkillRunError, string> = {
  INVALID_SKILL: 'O agente não devolveu uma skill válida.',
  AGENT_UNAVAILABLE: 'Esse agente não está disponível agora.',
  PAID_NEEDS_CONFIRM: 'Agente por API paga: confirme no botão.',
  CANCELED: 'Cancelado.',
  TIMEOUT: 'O agente não respondeu a tempo.',
  EMPTY_ANSWER: 'O agente não respondeu nada. Tente de novo ou escolha outro agente.',
  AGENT_ERROR: 'O agente deu erro. Tente de novo ou escolha outro agente.',
  FAILED: 'Algo deu errado. Tente de novo.',
}
const BUSY = { create: 'Criando…', test: 'Testando…', improve: 'Ajustando…' } as const

let seq = 0
const newDraftId = () => `d${Date.now()}_${++seq}`
const blank = (): Skill => ({ id: '', name: '', description: '', body: '', agentIds: [], updatedAt: 0 })
const paidLabel = (a: AgentDef | undefined) => (a && isPaidApi(a) && a.transport.kind === 'api' ? ` (API paga — ${providerName(a.transport.provider)})` : '')

export function SkillsScreen() {
  const { skills, load, setOpen } = useSkillStore()
  const { profiles, active } = useProfileStore()
  const project = useRunStore(s => s.project)
  const agents = useMemo(() => resolveAgentDefs(active), [active])
  const [current, setCurrent] = useState<Skill>()
  const [draftId, setDraftId] = useState(newDraftId)
  const [request, setRequest] = useState('')
  const [creatorId, setCreatorId] = useState(agents[0]?.id ?? '')
  const [testerId, setTesterId] = useState(agents[0]?.id ?? '')
  const [task, setTask] = useState('')
  const [answer, setAnswer] = useState<string>()
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState<keyof typeof BUSY>()
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => { void load() }, [load])

  const creator = agents.find(a => a.id === creatorId)
  const tester = agents.find(a => a.id === testerId)
  const hasContent = !!current && !!(current.name || current.body)
  const asDraft = (s: Skill): SkillDraft => ({ name: s.name, description: s.description, body: s.body })
  const edit = (p: Partial<Skill>) => { if (current) setCurrent({ ...current, ...p }); setErrors([]) }

  function pick(s: Skill) {
    setCurrent(s); setDraftId(newDraftId()); setAnswer(undefined); setErrors([]); setRequest(''); setFeedback('')
  }

  async function exec<T extends { ok: boolean }>(kind: keyof typeof BUSY, call: () => Promise<T>, done: (r: T) => void) {
    setBusy(kind); setErrors([])
    try {
      const r = await call()
      if (r.ok) done(r)
      else {
        const error = (r as unknown as { error: SkillRunError }).error
        if (error !== 'CANCELED') setErrors([ERRORS[error] ?? ERRORS.FAILED])
      }
    } catch {
      // ex.: entrada recusada no main (tamanho)
      setErrors([ERRORS.FAILED])
    } finally {
      setBusy(undefined)
    }
  }

  const create = () => exec('create',
    () => window.time.createSkill({ draftId, request, creatorId, confirmPaid: !!paidLabel(creator) }),
    r => { if (r.ok) setCurrent(c => ({ ...(c ?? blank()), ...r.skill })) })
  const test = () => current && exec('test',
    () => window.time.testSkill({ draftId, skill: asDraft(current), agentId: testerId, task, confirmPaid: !!paidLabel(tester), ...(project ? { projectPath: project.path } : {}) }),
    r => { if (r.ok) setAnswer(r.answer) })
  const improve = () => current && answer !== undefined && exec('improve',
    () => window.time.improveSkill({ draftId, skill: asDraft(current), creatorId, task, answer, confirmPaid: !!paidLabel(creator), ...(feedback.trim() ? { feedback } : {}) }),
    r => { if (r.ok) { setCurrent(c => ({ ...(c ?? blank()), ...r.skill })); setFeedback('') } })

  async function save() {
    if (!current) return
    const r = await window.time.saveSkill(current)
    if (!r.ok) { setErrors(r.errors); return }
    setCurrent(r.skill)
    await load()
  }

  async function remove() {
    if (!current?.id) return
    await window.time.deleteSkill(current.id)
    setCurrent(undefined)
    await load()
  }

  function close() {
    if (busy) void window.time.cancelSkill(draftId)
    setOpen(false)
  }

  const toggle = (id: string) => current && edit({ agentIds: current.agentIds.includes(id) ? current.agentIds.filter(x => x !== id) : [...current.agentIds, id] })
  const agentSelect = (label: string, value: string, set: (v: string) => void) => (
    <label>{label}{' '}
      <select aria-label={label} value={value} onChange={e => set(e.target.value)} disabled={!!busy}>
        {agents.map(a => <option key={a.id} value={a.id}>{a.nome}{paidLabel(a)}</option>)}
      </select>
    </label>
  )

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal profiles skills" onClick={e => e.stopPropagation()}>
        <div className="row between"><b>Skills</b><button onClick={close}>Fechar</button></div>
        <div className="profiles-body">
          <aside className="profiles-list">
            {skills.map(s => <button key={s.id} className={current?.id === s.id ? 'on' : ''} disabled={!!busy} onClick={() => pick(s)}>{s.name}</button>)}
            {current && !current.id && <button className="on">{current.name || 'Nova skill'} (não salva)</button>}
            <button className="menu-action" disabled={!!busy} onClick={() => pick(blank())}>Nova skill</button>
          </aside>
          {current ? (
            <section className="profile-edit">
              {!current.id && (
                <>
                  <label className="block">O que a skill deve fazer
                    <textarea aria-label="O que a skill deve fazer" rows={3} value={request} maxLength={5000} disabled={!!busy} onChange={e => setRequest(e.target.value)} />
                  </label>
                  <div className="opt-line wrap">
                    {agentSelect('Quem cria', creatorId, setCreatorId)}
                    <button className="primary" disabled={!!busy || !request.trim() || !creatorId} onClick={() => void create()}>
                      {busy === 'create' ? BUSY.create : `Criar${paidLabel(creator)}`}
                    </button>
                  </div>
                </>
              )}
              {hasContent && (
                <>
                  <div className="opt-line wrap">
                    <label>Nome <input aria-label="Nome" value={current.name} maxLength={64} onChange={e => edit({ name: e.target.value })} /></label>
                    <label>Quando usar <input aria-label="Quando usar" className="wide" value={current.description} maxLength={300} onChange={e => edit({ description: e.target.value })} /></label>
                  </div>
                  <label className="block">Instruções
                    <textarea aria-label="Instruções" rows={10} value={current.body} maxLength={BODY_MAX} onChange={e => edit({ body: e.target.value })} />
                  </label>
                  <h4>Teste</h4>
                  <label className="block">Tarefa de exemplo
                    <textarea aria-label="Tarefa de exemplo" rows={2} value={task} maxLength={5000} disabled={!!busy} onChange={e => setTask(e.target.value)} />
                  </label>
                  <div className="opt-line wrap">
                    {agentSelect('Quem testa', testerId, setTesterId)}
                    <button disabled={!!busy || !task.trim()} onClick={() => void test()}>{busy === 'test' ? BUSY.test : `Testar${paidLabel(tester)}`}</button>
                  </div>
                  {answer !== undefined && <pre className="skill-answer">{answer || '(sem resposta)'}</pre>}
                  <div className="opt-line wrap">
                    {current.id && agentSelect('Quem cria', creatorId, setCreatorId)}
                    <label>Comentário (opcional) <input aria-label="Comentário" className="wide" value={feedback} maxLength={5000} disabled={!!busy} onChange={e => setFeedback(e.target.value)} /></label>
                    <button disabled={!!busy || answer === undefined} onClick={() => void improve()}>{busy === 'improve' ? BUSY.improve : `Ajustar${paidLabel(creator)}`}</button>
                  </div>
                  <h4>Usada por</h4>
                  {profiles.map(p => (
                    <div key={p.id} className="opt-line wrap">
                      <span>{p.nome}</span>
                      {p.agents.map(a => (
                        <label key={a.id}><input type="checkbox" aria-label={a.nome} checked={current.agentIds.includes(a.id)} onChange={() => toggle(a.id)} />{a.nome}</label>
                      ))}
                    </div>
                  ))}
                </>
              )}
              {errors.length > 0 && <ul className="err">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
              {hasContent && (
                <div className="row">
                  <button className="primary" disabled={!!busy} onClick={() => void save()}>Salvar skill</button>
                  {current.id && <button className="danger" disabled={!!busy} onClick={() => void remove()}>Apagar skill</button>}
                </div>
              )}
            </section>
          ) : (
            <section className="profile-edit"><p className="muted">Escolha uma skill ou crie uma nova: você descreve, um agente escreve e testa.</p></section>
          )}
        </div>
      </div>
    </div>
  )
}
