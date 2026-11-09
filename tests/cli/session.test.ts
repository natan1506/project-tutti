import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AutonomyLevel } from '@shared/autonomy'
import type { AgentEvent } from '@shared/events'
import type { AdapterRunOptions, AgentAdapter } from '../../src/main/adapters/types'
import { createCore } from '../../src/main/core'
import { runGit } from '../../src/main/git/git'
import type { Brain } from '../../src/main/team/brain'
import { Session } from '../../src/cli/session'

const noCrypto = { isAvailable: () => false, encrypt: () => { throw new Error('x') }, decrypt: () => { throw new Error('x') } }
const brain = {
  triage: async () => null, lineup: async () => null,
  plan: async () => ({ tarefa: 'Criar soma.js', pronto: 'teste passa' }),
  review: async () => ({ pronto: true, falta: '' }),
} as Brain
class Work implements AgentAdapter {
  async *run(o: AdapterRunOptions): AsyncGenerator<AgentEvent> {
    if (o.mode !== 'consult') writeFileSync(join(o.cwd, 'soma.js'), 'x\n')
    yield { type: 'text', text: `${o.agent.nome} trabalhou.` }
    yield { type: 'done' }
  }
}

async function setup(o: { git?: boolean; autonomy?: AutonomyLevel } = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "proj-")))
  if (o.git !== false) { await runGit(cwd, ['init', '-q']); writeFileSync(join(cwd, 'a.txt'), 'a\n') }
  let session: Session | undefined
  const w = new Work()
  const core = await createCore({
    dataDir: mkdtempSync(join(tmpdir(), 'data-')), crypto: noCrypto, brain,
    adapters: { claude: w, codex: w, gemini: w, opencode: w }, toolReady: async () => true,
    emit: (id, ev) => session?.onEvent(id, ev),
  })
  core.store.setSetting(`autonomy:${cwd}`, o.autonomy ?? 'autonomous')
  session = await Session.open(core, cwd)
  const until = async (cond: () => boolean) => { for (let i = 0; i < 300 && !cond(); i++) await new Promise(r => setTimeout(r, 10)) }
  const texts = () => session!.lines().map(l => l.text)
  return { session, core, cwd, until, texts }
}

describe('sessão do terminal', () => {
  it('abre no perfil Trabalho e mostra os 4 agentes da esteira no placar', async () => {
    const t = await setup()
    expect(t.session.profileName()).toBe('Trabalho')
    expect(t.session.esteiraAgents().map(a => `${a.nome}:${a.tool}`)).toEqual(['Bússola:claude', 'Forja:codex', 'Lupa:codex', 'Curinga:opencode'])
    await t.core.close()
  })

  it('texto livre roda a esteira e as etapas viram linhas', async () => {
    const t = await setup()
    await t.session.run({ kind: 'send', text: 'crie soma' })
    await t.until(() => t.texts().includes('Pronto.'))
    expect(t.texts()).toEqual(expect.arrayContaining(['Plano: Criar soma.js\n  Pronto quando: teste passa', 'Forja  Criar soma.js', '✓ Revisão: pronto', 'Pronto.']))
    await t.core.close()
  })

  it('autonomia que pede aprovação: o plano fica pendente e "s" segue', async () => {
    const t = await setup({ autonomy: 'accept_edits' })
    await t.session.run({ kind: 'send', text: 'crie soma' })
    await t.until(() => t.session.pending()?.kind === 'plan')
    expect(t.session.pending()!.text).toContain('Criar soma.js')
    t.session.answer('s')
    await t.until(() => t.texts().includes('Pronto.'))
    expect(t.session.pending()).toBeNull()
    await t.core.close()
  })

  it('/undo em pasta sem git avisa que não há o que desfazer', async () => {
    const t = await setup({ git: false })
    expect(await t.session.run({ kind: 'undo' })).toEqual({ message: 'Esta pasta não usa git: não há o que desfazer.' })
    await t.core.close()
  })

  it('/config executor Curinga muda a esteira salva', async () => {
    const t = await setup()
    await t.session.run({ kind: 'config', key: 'executor', value: 'curinga' })
    expect(t.session.esteiraAgents()[1].nome).toBe('Curinga')
    await t.core.close()
  })

  it('/config autonomia grava o nível do projeto; valor errado é recusado', async () => {
    const t = await setup()
    expect((await t.session.run({ kind: 'config', key: 'autonomia', value: 'xyz' })).message).toContain('ask_all')
    await t.session.run({ kind: 'config', key: 'autonomia', value: 'ask_all' })
    expect(t.core.store.getSetting(`autonomy:${t.cwd}`)).toBe('ask_all')
    await t.core.close()
  })

  it('/new começa outra conversa e /history lista as duas', async () => {
    const t = await setup()
    const first = t.session.conversationId
    await t.session.run({ kind: 'new' })
    expect(t.session.conversationId).not.toBe(first)
    expect((await t.session.run({ kind: 'history' })).message).toMatch(/1\. .*\n2\. /)
    await t.core.close()
  })

  it('/exit pede para sair', async () => {
    const t = await setup()
    expect(await t.session.run({ kind: 'exit' })).toEqual({ exit: true })
    await t.core.close()
  })
})

describe('onde o tutti abre', () => {
  it('numa subpasta do repositório, o projeto é a raiz (mesma trava do app)', async () => {
    const t = await setup()
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(t.cwd, 'src'))
    const s = await Session.open(t.core, join(t.cwd, 'src'))
    expect(s.project.path).toBe(realpathSync(t.cwd))
    await t.core.close()
  })
  it('na pasta pessoal não roda o time', async () => {
    const t = await setup()
    const s = await Session.open(t.core, homedir())
    expect((await s.run({ kind: 'send', text: 'oi' })).message).toBe('Abra o tutti dentro da pasta de um projeto (não na pasta pessoal nem na raiz).')
    expect(t.core.store.listRuns(s.conversationId)).toEqual([])
    await t.core.close()
  })
})
