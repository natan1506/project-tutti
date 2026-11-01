import { describe, expect, it } from 'vitest'
import { getAgent, knownAgent } from '@shared/agents'
import { PADRAO, type Profile } from '@shared/profiles'
import { ProfileService } from '../../../src/main/profiles/profileService'
import { openStore } from '../../../src/main/store/db'

const novo = (): Profile => ({
  id: '', nome: 'Duo', builtin: false, defaults: { transport: { kind: 'cli', tool: 'claude' } },
  agents: [{ id: '', nome: 'Claudinho', prompt: 'Escreve código.', funcao: 'Geral', readOnly: false, reviewer: false, consultable: false }],
})
function setup() {
  const store = openStore(':memory:')
  const emitted: Profile[][] = []
  const svc = new ProfileService({ store, emit: ps => emitted.push(ps) })
  const projA = store.upsertProject('/a').id
  const projB = store.upsertProject('/b').id
  return { store, svc, emitted, projA, projB }
}
const saved = (r: ReturnType<ProfileService['save']>) => { if (!r.ok) throw new Error(r.errors.join()); return r.profile }

describe('ProfileService', () => {
  it('Padrão vem primeiro e não se edita nem se apaga', () => {
    const { svc } = setup()
    expect(svc.all()[0].id).toBe('padrao')
    expect(svc.save({ ...PADRAO, nome: 'X' }).ok).toBe(false)
    expect(() => svc.remove('padrao')).toThrow()
  })
  it('salvar perfil novo gera ids e registra os agentes', () => {
    const { svc, emitted } = setup()
    const p = saved(svc.save(novo()))
    expect(p.id).toMatch(/^p_/)
    expect(p.agents[0].id).toMatch(/^a_/)
    expect(p.builtin).toBe(false)
    expect(getAgent(p.agents[0].id).nome).toBe('Claudinho')
    expect(emitted.at(-1)!.map(x => x.id)).toEqual(['padrao', p.id])
  })
  it('perfil inválido devolve os erros', () => {
    const { svc } = setup()
    const r = svc.save({ ...novo(), agents: [] })
    expect(r.ok).toBe(false)
  })
  it('duplicar o Padrão cria agentes novos', () => {
    const { svc } = setup()
    const c = svc.duplicate('padrao')
    expect(c.nome).toBe('Padrão (cópia)')
    expect(c.builtin).toBe(false)
    expect(c.coordinatorId).toBe(c.agents[0].id)
    expect(c.agents.some(a => PADRAO.agents.some(b => b.id === a.id))).toBe(false)
    expect(knownAgent(c.agents[0].id)).toBe(true)
    expect(svc.all().map(p => p.id)).toContain(c.id)
  })
  it('apagar o perfil do projeto volta ao Padrão; agentes antigos ficam com "(removido)"', () => {
    const { svc, store, projA } = setup()
    const p = saved(svc.save(novo()))
    svc.setActive(projA, p.id)
    svc.remove(p.id)
    expect(svc.activeFor(projA).id).toBe('padrao')
    expect(getAgent(p.agents[0].id).nome).toBe('Claudinho (removido)')
    new ProfileService({ store, emit: () => {} })
    expect(getAgent(p.agents[0].id).nome).toBe('Claudinho (removido)')
  })
  it('cada projeto lembra o seu perfil; perfil inexistente cai no Padrão', () => {
    const { svc, projA, projB, store } = setup()
    const p = saved(svc.save(novo()))
    svc.setActive(projA, p.id)
    expect(svc.activeFor(projA).id).toBe(p.id)
    expect(svc.activeFor(projB).id).toBe('padrao')
    store.setSetting(`profile:${projB}`, 'sumiu')
    expect(svc.activeFor(projB).id).toBe('padrao')
    expect(() => svc.setActive(projA, 'sumiu')).toThrow()
  })
  it('perfis salvos voltam depois de reabrir', () => {
    const { svc, store } = setup()
    const p = saved(svc.save(novo()))
    expect(new ProfileService({ store, emit: () => {} }).all().map(x => x.id)).toEqual(['padrao', p.id])
  })
})
