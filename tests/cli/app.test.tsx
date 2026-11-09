import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/cli/App'
import type { SessionView } from '../../src/cli/session'

function stub(over: Partial<SessionView> = {}): SessionView {
  return {
    header: () => 'Tutti · app',
    esteiraAgents: () => [{ nome: 'Bússola', tool: 'claude' }, { nome: 'Forja', tool: 'codex' }, { nome: 'Lupa', tool: 'codex' }, { nome: 'Curinga', tool: 'opencode' }],
    usage: () => ({ rows: [], at: 0 }),
    lines: () => [{ text: 'olá' }],
    pending: () => null,
    run: vi.fn(async () => ({})),
    answer: vi.fn(),
    say: vi.fn(),
    subscribe: () => () => {},
    ...over,
  }
}
const tick = () => new Promise(r => setTimeout(r, 30))

describe('tela do terminal', () => {
  it('o placar com os 4 agentes é a primeira linha', () => {
    const r = render(<App session={stub()} exit={() => {}} width={100} />)
    const first = r.lastFrame()!.split('\n')[0]
    expect(first).toContain('Tutti · app')
    for (const n of ['Bússola', 'Forja', 'Lupa', 'Curinga']) expect(first).toContain(n)
  })

  it('digitar /exit e Enter fecha', async () => {
    const exit = vi.fn()
    const s = stub({ run: vi.fn(async () => ({ exit: true as const })) })
    const r = render(<App session={s} exit={exit} width={100} />)
    await tick()
    r.stdin.write('/exit')
    await tick()
    r.stdin.write('\r')
    await tick()
    expect(s.run).toHaveBeenCalledWith({ kind: 'exit' })
    expect(exit).toHaveBeenCalled()
  })

  it('depois do Enter a caixa de texto fica vazia', async () => {
    const r = render(<App session={stub()} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('/agents')
    await tick()
    r.stdin.write('\r')
    await tick()
    r.stdin.write('x')
    await tick()
    expect(r.lastFrame()).toContain('› x')
    expect(r.lastFrame()).not.toContain('/agentsx')
  })

  it('digitação rápida seguida de Enter manda o texto inteiro', async () => {
    const s = stub()
    const r = render(<App session={s} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('/')
    r.stdin.write('u')
    r.stdin.write('s')
    r.stdin.write('a')
    r.stdin.write('g')
    r.stdin.write('e')
    r.stdin.write('\r')
    await tick()
    expect(s.run).toHaveBeenCalledWith({ kind: 'usage' })
  })

  it('texto e Enter chegando juntos num pedaço só também enviam', async () => {
    const s = stub()
    const r = render(<App session={s} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('/con')
    await tick()
    r.stdin.write('fig\r')
    await tick()
    expect(s.run).toHaveBeenCalledWith({ kind: 'config' })
    r.stdin.write('x')
    await tick()
    expect(r.lastFrame()).toContain('› x')
  })

  it('Ctrl+C fecha', async () => {
    const exit = vi.fn()
    const r = render(<App session={stub()} exit={exit} width={100} />)
    await tick()
    r.stdin.write('\x03')
    await tick()
    expect(exit).toHaveBeenCalled()
  })

  it('com pendência, "s" + Enter responde a ela', async () => {
    const s = stub({ pending: () => ({ kind: 'plan', id: 'p1', text: 'Plano: X' }) })
    const r = render(<App session={s} exit={() => {}} width={100} />)
    expect(r.lastFrame()).toContain('[s/n]')
    await tick()
    r.stdin.write('s')
    await tick()
    r.stdin.write('\r')
    await tick()
    expect(s.answer).toHaveBeenCalledWith('s')
    expect(s.run).not.toHaveBeenCalled()
  })
})
