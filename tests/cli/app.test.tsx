import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { App, fitLines, screenLines } from '../../src/cli/App'
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
    reply: vi.fn(),
    configView: () => [
      { key: 'perfil', label: 'Perfil', value: 'Trabalho', hint: 'Qual time este projeto usa', options: [{ value: 'p1', label: 'Trabalho' }] },
      { key: 'cerebro', label: 'Cérebro', value: 'Bússola', hint: 'Planeja o pedido e revisa o resultado', options: [{ value: 'tb', label: 'Bússola' }] },
      { key: 'executor', label: 'Executor', value: 'Forja', hint: 'Implementa a tarefa que o cérebro escreveu', options: [{ value: 'tf', label: 'Forja', hint: 'Codex' }, { value: 'tc', label: 'Curinga', hint: 'opencode' }] },
    ],
    setConfig: vi.fn(() => 'Executor: Curinga.'),
    agentsView: () => [{ nome: 'Bússola', ia: 'Claude', modelo: 'claude-opus-5-5', papel: 'cérebro', uso: '87%' }],
    historyView: () => [{ index: 1, title: 'crie soma', when: '09/11 09:42', prompts: 1, current: true }, { index: 2, title: 'outra', when: '08/11 10:00', prompts: 2, current: false }],
    resume: vi.fn(() => 'Retomei: outra.'),
    usageView: () => ({ gasto: [{ nome: 'Forja', tokens: '12,0k' }], limites: [{ ia: 'Claude', uso: '87%', volta: 'seg 12:00' }] }),
    mcpView: () => [{ id: 'm1', nome: 'linear', estado: 'ligado', modo: 'só leitura', leitura: 12, escrita: 20, precisaDoApp: false }],
    toggleMcp: vi.fn(),
    toggleTesterFree: vi.fn(() => 'Lupa usa todas as ferramentas do playwright.'),
    mcpImportable: async () => [{ nome: 'playwright' }],
    importMcp: vi.fn(async () => 'playwright importado (desligado).'),
    activity: () => null,
    subscribe: () => () => {},
    ...over,
  }
}
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))

describe('tela do terminal', () => {
  it('o placar com os 4 agentes é a primeira linha (depois da margem)', () => {
    const r = render(<App session={stub()} exit={() => {}} width={100} />)
    const first = r.lastFrame()!.split('\n')[1]
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
    r.stdin.write('\u001B')
    await tick()
    r.stdin.write('x')
    await tick()
    expect(r.lastFrame()).toContain('› x')
  })

  it('linha vazia da conversa ocupa espaço (separa a tela de entrada)', () => {
    const r = render(<App session={stub({ lines: () => [{ text: 'A' }, { text: '' }, { text: 'B' }] })} exit={() => {}} width={100} />)
    const rows = r.lastFrame()!.split('\n')
    expect(rows.findIndex(l => l.trim() === 'B') - rows.findIndex(l => l.trim() === 'A')).toBe(2)
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
    expect(r.lastFrame()).toContain('1. Aprovar')
    await tick()
    r.stdin.write('s')
    await tick()
    r.stdin.write('\r')
    await tick()
    expect(s.answer).toHaveBeenCalledWith('s')
    expect(s.run).not.toHaveBeenCalled()
  })
})

const DOWN = '\u001B[B', UP = '\u001B[A', ESC = '\u001B'
const panelStub = (kind: string) => stub({ run: vi.fn(async () => ({ panel: kind as never })) })

describe('no estilo do Claude Code', () => {
  it('"/" abre o menu de comandos com o que cada um faz; filtra ao digitar', async () => {
    const r = render(<App session={stub()} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('/')
    await tick()
    expect(r.lastFrame()).toContain('/config')
    expect(r.lastFrame()).toContain('Escolher quem é cérebro')
    expect(r.lastFrame()).toContain('/history')
    r.stdin.write('hi')
    await tick()
    expect(r.lastFrame()).toContain('/history')
    expect(r.lastFrame()).not.toContain('/config ')
  })

  it('↓ escolhe no menu e Enter roda o comando escolhido; Tab completa', async () => {
    const s = stub()
    const r = render(<App session={s} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('/')
    await tick()
    r.stdin.write(DOWN)
    await tick()
    r.stdin.write('\r')
    await tick()
    expect(s.run).toHaveBeenCalledWith({ kind: 'agents' })
    r.stdin.write('/hi')
    await tick()
    r.stdin.write('\t')
    await tick()
    expect(r.lastFrame()).toContain('› /history')
  })

  it('/config abre um painel: cada linha com valor e explicação; Enter mostra as opções; escolher salva', async () => {
    const s = panelStub('config')
    const r = render(<App session={s} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('/config\r')
    await tick()
    const f = r.lastFrame()!
    expect(f).toContain('Executor')
    expect(f).toContain('Forja')
    expect(f).toContain('Implementa a tarefa')
    expect(f).toContain('Esc')
    r.stdin.write(DOWN); await tick()
    r.stdin.write(DOWN); await tick()
    r.stdin.write('\r'); await tick()
    expect(r.lastFrame()).toContain('Curinga')
    expect(r.lastFrame()).toContain('opencode')
    r.stdin.write(DOWN); await tick()
    r.stdin.write('\r'); await tick()
    expect(s.setConfig).toHaveBeenCalledWith('executor', 'tc')
    expect(r.lastFrame()).toContain('Executor: Curinga.')
    r.stdin.write(ESC); await tick()
    expect(r.lastFrame()).not.toContain('Implementa a tarefa')
  })

  it('/history abre a lista; Enter retoma a conversa escolhida', async () => {
    const s = panelStub('history')
    const r = render(<App session={s} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('/history\r'); await tick()
    expect(r.lastFrame()).toContain('crie soma')
    r.stdin.write(DOWN); await tick()
    r.stdin.write('\r'); await tick()
    expect(s.resume).toHaveBeenCalledWith(2)
  })

  it('/agents e /usage mostram tabelas', async () => {
    const r = render(<App session={panelStub('agents')} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('/agents\r'); await tick()
    expect(r.lastFrame()).toContain('claude-opus-5-5')
    expect(r.lastFrame()).toContain('cérebro')
    const u = render(<App session={panelStub('usage')} exit={() => {}} width={100} />)
    await tick()
    u.stdin.write('/usage\r'); await tick()
    expect(u.lastFrame()).toContain('12,0k')
    expect(u.lastFrame()).toContain('seg 12:00')
  })

  it('aprovação do plano com setas: 1. Aprovar  2. Recusar', async () => {
    const s = stub({ pending: () => ({ kind: 'plan', id: 'p1', text: 'Plano: X' }) })
    const r = render(<App session={s} exit={() => {}} width={100} />)
    await tick()
    expect(r.lastFrame()).toContain('1. Aprovar')
    expect(r.lastFrame()).toContain('2. Recusar')
    r.stdin.write(DOWN); await tick()
    r.stdin.write('\r'); await tick()
    expect(s.answer).toHaveBeenCalledWith('n')
  })

  it('resposta de comando vai como bloco (reply), não grudada', async () => {
    const s = stub({ run: vi.fn(async () => ({ message: 'Conversa nova.' })) })
    const r = render(<App session={s} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('/new\r'); await tick()
    expect(s.reply).toHaveBeenCalledWith('Conversa nova.')
  })
})

describe('painel /mcp', () => {
  it('lista com estado e contagem; Enter liga/desliga; i importa', async () => {
    const s = stub({ run: vi.fn(async () => ({ panel: 'mcp' as never })) })
    const r = render(<App session={s} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('/mcp\r'); await tick()
    expect(r.lastFrame()).toContain('linear')
    expect(r.lastFrame()).toContain('12 de leitura')
    r.stdin.write('\r'); await tick()
    expect(s.toggleMcp).toHaveBeenCalledWith('m1')
    r.stdin.write('i'); await tick(80)
    expect(r.lastFrame()).toContain('playwright')
    r.stdin.write('\r'); await tick(80)
    expect(s.importMcp).toHaveBeenCalledWith('playwright')
  })
})

describe('colar texto (como no Claude Code)', () => {
  const texto = 'linha 1\nlinha 2\nlinha 3'
  it('colagem com várias linhas vira um bloco e não envia nada', async () => {
    const s = stub()
    const r = render(<App session={s} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write(`\u001B[200~${texto}\u001B[201~`)
    await tick(80)
    expect(s.run).not.toHaveBeenCalled()
    expect(r.lastFrame()).toContain('[Texto colado #1 +3 linhas]')
    r.stdin.write('\r')
    await tick(80)
    expect(s.run).toHaveBeenCalledTimes(1)
    expect(s.run).toHaveBeenCalledWith({ kind: 'send', text: texto })
  })
  it('dá para escrever antes do bloco colado', async () => {
    const s = stub()
    const r = render(<App session={s} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('resuma isto: ')
    await tick()
    r.stdin.write(`\u001B[200~${texto}\u001B[201~`)
    await tick(80)
    r.stdin.write('\r')
    await tick(80)
    expect(s.run).toHaveBeenCalledWith({ kind: 'send', text: `resuma isto: ${texto}` })
  })
  it('terminal sem bracketed paste: pedaço com várias linhas também é colagem, não vários Enters', async () => {
    const s = stub()
    const r = render(<App session={s} exit={() => {}} width={100} />)
    await tick()
    r.stdin.write('a\nb\nc\n')
    await tick(80)
    expect(s.run).not.toHaveBeenCalled()
    expect(r.lastFrame()).toContain('[Texto colado #1')
  })
})

describe('tela não estoura a janela', () => {
  it('linha longa conta como várias linhas na altura', () => {
    const lines = [{ text: 'a' }, { text: 'x'.repeat(250) }, { text: 'b' }]
    expect(fitLines(lines, 100, 3).map(l => l.text[0])).toEqual(['b'])
    expect(fitLines(lines, 100, 4).map(l => l.text[0])).toEqual(['x', 'b'])
    expect(fitLines(lines, 100, 5).map(l => l.text[0])).toEqual(['a', 'x', 'b'])
  })
})

describe('tela cheia', () => {
  const frame = (n: number, h: number) => {
    const many = Array.from({ length: n }, (_, i) => ({ text: `linha ${i} ${'y'.repeat(i % 3 === 0 ? 150 : 5)}` }))
    const r = render(<App session={stub({ lines: () => many })} exit={() => {}} width={100} height={h} />)
    return r.lastFrame()!.split('\n')
  }
  it('ocupa a altura da janela: placar na primeira linha e caixa de entrada no fim, com pouca ou muita conversa', () => {
    for (const n of [1, 400]) {
      const rows = frame(n, 24)
      expect(rows).toHaveLength(24)
      expect(rows[0].trim()).toBe('')
      expect(rows[1]).toMatch(/^ {2}Tutti · app/)
      expect(rows.slice(-4).join('\n')).toContain('╰')
    }
  })
  it('conversa curta fica logo abaixo do placar', () => {
    expect(frame(1, 24)[3]).toContain('linha 0')
  })
  it('na conversa longa, a última linha aparece', () => {
    expect(frame(400, 24).join('\n')).toContain('linha 399')
  })
})

describe('aprovação e andamento', () => {
  it('plano longo: a caixa mostra só a pergunta e as opções, sem passar da tela', () => {
    const plan = Array.from({ length: 40 }, (_, i) => `passo ${i}`).join('\n')
    const r = render(<App session={stub({ pending: () => ({ kind: 'plan', id: 'x', text: plan }) })} exit={() => {}} width={100} height={30} />)
    const rows = r.lastFrame()!.split('\n')
    expect(rows).toHaveLength(30)
    expect(rows.join('\n')).toContain('1. Aprovar')
    expect(rows.join('\n')).toContain('2. Recusar')
    expect(rows.join('\n')).not.toContain('passo 0')
  })
  it('pedido de permissão longo é cortado em poucas linhas', () => {
    const r = render(<App session={stub({ pending: () => ({ kind: 'approval', id: 'x', text: 'rm '.repeat(400) }) })} exit={() => {}} width={100} height={30} />)
    const rows = r.lastFrame()!.split('\n')
    expect(rows).toHaveLength(30)
    expect(rows.join('\n')).toContain('2. Negar')
  })
  it('enquanto o time trabalha, uma linha diz quem está fazendo o quê e há quanto tempo', () => {
    const r = render(<App session={stub({ activity: () => ({ text: 'Forja executando a tarefa', detail: 'Editando soma.js', since: Date.now() - 12_000 }) })} exit={() => {}} width={100} height={30} />)
    const f = r.lastFrame()!
    expect(f).toMatch(/Forja executando a tarefa.*12s.*Editando soma\.js/)
  })
  it('o plano tem o título colorido e o corpo na cor normal', () => {
    const [head, body] = screenLines([{ text: 'Plano\ncorpo do plano', color: 'cyan', bold: true, head: true }])
    expect(head).toMatchObject({ text: 'Plano', color: 'cyan', bold: true })
    expect(body).toMatchObject({ text: 'corpo do plano', color: undefined, bold: false })
  })
})

describe('/mcp: liberar para o tester', () => {
  it('"t" na linha do MCP libera para o tester e mostra a confirmação', async () => {
    const s = stub({ run: vi.fn(async () => ({ panel: 'mcp' as const })) })
    const r = render(<App session={s} exit={() => {}} width={120} height={40} />)
    await tick()
    r.stdin.write('/mcp'); await tick(); r.stdin.write('\r'); await tick(80)
    r.stdin.write('t'); await tick()
    expect(s.toggleTesterFree).toHaveBeenCalledWith('m1')
    expect(r.lastFrame()).toContain('Lupa usa todas as ferramentas do playwright.')
  })
})

