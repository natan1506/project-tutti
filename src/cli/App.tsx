import { Box, Text, useInput } from 'ink'
import { useEffect, useReducer, useRef, useState } from 'react'
import { parseCommand, type ConfigKey } from './commands'
import { COMMANDS, matchCommands } from './menus'
import { placar } from './placar'
import type { PanelKind, SessionView } from './session'

// Tela do terminal (spec tutti-terminal §4), no estilo do Claude Code: placar no topo, conversa, caixa de texto com
// moldura, menu de comandos ao digitar "/", painéis navegáveis (/config, /agents, /history, /usage, /help) e
// aprovação com setas.

const ACCENT = '#8b6cf6'
const MUTED = 'gray'
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))

type Panel = { kind: PanelKind; row: number; picking: number | null; status?: string; importList?: { nome: string }[] }

export function App({ session, exit, width, height = 40 }: { session: SessionView; exit: () => void; width: number; height?: number }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const [input, setInput] = useState('')
  const [menuSel, setMenuSel] = useState(0)
  const [choice, setChoice] = useState(0)
  const [panel, setPanelState] = useState<Panel | null>(null)
  useEffect(() => session.subscribe(redraw), [session])

  // Teclas chegam mais rápido que a tela redesenha: texto e painel vivem em refs, e o estado só redesenha.
  const typed = useRef('')
  const panelRef = useRef<Panel | null>(null)
  const sel = useRef(0)
  const type = (next: string) => { typed.current = next; setInput(next); sel.current = 0; setMenuSel(0) }
  const setPanel = (p: Panel | null) => { panelRef.current = p; setPanelState(p) }

  const submit = async (raw: string) => {
    const text = raw.trim()
    if (!text) return
    const r = await session.run(parseCommand(text))
    if (r.exit) return exit()
    if (r.panel) setPanel({ kind: r.panel, row: 0, picking: null })
    if (r.message) session.reply(r.message)
  }

  const panelKeys = (p: Panel, ch: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) => {
    const move = (n: number, len: number) => (len ? (n + len) % len : 0)
    if (p.kind === 'config') {
      const rows = session.configView()
      if (p.picking !== null) {
        const opts = rows[p.row].options
        if (key.escape) return setPanel({ ...p, picking: null })
        if (key.upArrow || key.downArrow) return setPanel({ ...p, picking: move(p.picking + (key.upArrow ? -1 : 1), opts.length) })
        if (key.return) {
          const status = session.setConfig(rows[p.row].key as ConfigKey, opts[p.picking].value)
          return setPanel({ ...p, picking: null, status })
        }
        return
      }
      if (key.escape) return setPanel(null)
      if (key.upArrow || key.downArrow) return setPanel({ ...p, row: move(p.row + (key.upArrow ? -1 : 1), rows.length), status: undefined })
      if (key.return) {
        const cur = rows[p.row]
        const at = Math.max(0, cur.options.findIndex(o => o.label === cur.value))
        return setPanel({ ...p, picking: at, status: undefined })
      }
      return
    }
    if (p.kind === 'mcp') {
      if (p.importList) {
        if (key.escape) return setPanel({ ...p, importList: undefined, picking: null })
        if (key.upArrow || key.downArrow) return setPanel({ ...p, picking: move((p.picking ?? 0) + (key.upArrow ? -1 : 1), p.importList.length) })
        if (key.return && p.importList[p.picking ?? 0]) {
          const nome = p.importList[p.picking ?? 0].nome
          setPanel({ ...p, importList: undefined, picking: null, status: `Importando ${nome}…` })
          void session.importMcp(nome).catch(e => `Não consegui importar ${nome}: ${String(e)}`).then(status => { if (panelRef.current?.kind === 'mcp') setPanel({ ...panelRef.current, status }) })
        }
        return
      }
      const rows = session.mcpView()
      if (key.escape) return setPanel(null)
      if (key.upArrow || key.downArrow) return setPanel({ ...p, row: move(p.row + (key.upArrow ? -1 : 1), rows.length), status: undefined })
      if (key.return && rows[p.row]) { session.toggleMcp(rows[p.row].id); return setPanel({ ...p, status: undefined }) }
      if (ch === 'i') {
        void session.mcpImportable().then(list => {
          const cur = panelRef.current
          if (cur?.kind === 'mcp') setPanel(list.length ? { ...cur, importList: list, picking: 0 } : { ...cur, status: 'Nada novo para importar do Claude Code.' })
        })
      }
      return
    }
    if (p.kind === 'history') {
      const rows = session.historyView()
      if (key.escape) return setPanel(null)
      if (key.upArrow || key.downArrow) return setPanel({ ...p, row: move(p.row + (key.upArrow ? -1 : 1), rows.length) })
      if (key.return && rows[p.row]) { const msg = session.resume(rows[p.row].index); setPanel(null); session.reply(msg) }
      return
    }
    if (key.escape || key.return || ch === 'q') setPanel(null)
  }

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') { exit(); return }
    const p = panelRef.current
    if (p) { panelKeys(p, ch, key); return }

    const pending = session.pending()
    if (pending && pending.kind !== 'question') {
      if (key.upArrow || key.downArrow) { setChoice(c => 1 - c); return }
      if (key.return) { session.answer(choice === 0 ? 's' : 'n'); setChoice(0); return }
      const k = ch?.toLowerCase()
      if (k === 's' || k === '1' || k === 'y') { session.answer('s'); setChoice(0); return }
      if (k === 'n' || k === '2') { session.answer('n'); setChoice(0); return }
      return
    }

    const matches = matchCommands(typed.current)
    if (matches.length && (key.upArrow || key.downArrow)) {
      sel.current = (sel.current + (key.upArrow ? -1 : 1) + matches.length) % matches.length
      setMenuSel(sel.current)
      return
    }
    if (matches.length && key.tab) { type(`/${matches[sel.current].name}`); return }
    if (key.escape) { type(''); return }
    if (key.return) {
      const text = typed.current
      const pick = matches[sel.current]
      type('')
      if (pending) { if (text.trim()) session.answer(text); return }
      void submit(pick ? `/${pick.name}` : text)
      return
    }
    if (key.backspace || key.delete) { type(typed.current.slice(0, -1)); return }
    if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return
    if (!ch) return
    // Processo ocupado: letras e Enter podem chegar num pedaço só ("fig\r"); cada quebra de linha envia.
    const parts = ch.split(/\r\n|\r|\n/)
    for (let i = 0; i < parts.length - 1; i++) {
      const text = typed.current + parts[i]
      type('')
      if (pending) session.answer(text)
      else void submit(text)
    }
    type(typed.current + parts.at(-1)!)
  })

  const pl = placar(session.header(), session.esteiraAgents(), session.usage(), width, Date.now())
  const pending = session.pending()
  const matches = panel || pending ? [] : matchCommands(input)
  const below = panel ? 14 : matches.length ? matches.length + 1 : 1
  const room = Math.max(3, height - 5 - below - (pending ? 5 : 0))
  const lines = session.lines().flatMap(l => (l.parts ? [l] : l.text.split('\n').map(t => ({ ...l, text: t })))).slice(-room)
  const boxWidth = Math.max(20, width - 1)

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text bold>{pl.header}</Text>
        {pl.cells.map((c, i) => (
          <Text key={i}>{'   '}<Text bold>{c.nome}</Text> <Text color={c.color}>{c.text}</Text></Text>
        ))}
      </Text>
      <Text color={MUTED}>{'─'.repeat(Math.max(10, width))}</Text>
      {lines.map((l, i) => (l.parts
        ? <Text key={i} wrap="truncate">{l.parts.map((x, j) => <Text key={j} {...(x.color ? { color: x.color } : {})} {...(x.bg ? { backgroundColor: x.bg } : {})}>{x.text}</Text>)}</Text>
        : <Text key={i} {...(l.color ? { color: l.color } : {})} wrap="wrap">{l.text || ' '}</Text>))}

      {pending && pending.kind !== 'question' && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={boxWidth}>
          <Text color="yellow" bold>{pending.kind === 'plan' ? 'Aprovar o plano?' : 'Permitir?'}</Text>
          <Text wrap="wrap">{pending.text}</Text>
          <Text> </Text>
          <Text color={choice === 0 ? 'cyan' : undefined}>{choice === 0 ? '❯ ' : '  '}1. {pending.kind === 'plan' ? 'Aprovar' : 'Permitir'}</Text>
          <Text color={choice === 1 ? 'cyan' : undefined}>{choice === 1 ? '❯ ' : '  '}2. {pending.kind === 'plan' ? 'Recusar' : 'Negar'}</Text>
        </Box>
      )}
      {pending?.kind === 'question' && <Text color="yellow">{pending.text}</Text>}

      {panel ? <PanelView panel={panel} session={session} width={boxWidth} /> : (
        <Box borderStyle="round" borderColor={MUTED} paddingX={1} width={boxWidth}>
          <Text><Text color="cyan">› </Text>{input}<Text inverse> </Text></Text>
        </Box>
      )}

      {!panel && (matches.length ? (
        <Box flexDirection="column" paddingX={1}>
          {matches.map((c, i) => (
            <Text key={c.name} wrap="truncate">
              <Text color={i === menuSel ? 'cyan' : undefined} bold={i === menuSel}>{i === menuSel ? '❯ ' : '  '}{pad(`/${c.name}`, 11)}</Text>
              <Text color={MUTED}>{c.desc}</Text>
            </Text>
          ))}
        </Box>
      ) : (
        <Text color={MUTED}>  / comandos  ·  ↑↓ navegar  ·  Tab completar  ·  Esc limpar  ·  Ctrl+C sair</Text>
      ))}
    </Box>
  )
}

function Frame({ title, width, footer, children }: { title: string; width: number; footer: string; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1} width={width}>
      <Text color={ACCENT} bold>{title}</Text>
      <Text> </Text>
      {children}
      <Text> </Text>
      <Text color={MUTED}>{footer}</Text>
    </Box>
  )
}

function PanelView({ panel, session, width }: { panel: Panel; session: SessionView; width: number }) {
  if (panel.kind === 'config') {
    const rows = session.configView()
    if (panel.picking !== null) {
      const row = rows[panel.row]
      return (
        <Frame title={`${row.label} — ${row.hint}`} width={width} footer="↑↓ escolher  ·  Enter confirmar  ·  Esc voltar">
          {row.options.map((o, i) => (
            <Text key={o.value} wrap="truncate">
              <Text color={i === panel.picking ? 'cyan' : undefined} bold={i === panel.picking}>{i === panel.picking ? '❯ ' : '  '}{pad(o.label, 18)}</Text>
              <Text color={MUTED}>{o.hint ?? ''}</Text>
              {o.label === row.value && <Text color="green">  ✓ atual</Text>}
            </Text>
          ))}
        </Frame>
      )
    }
    return (
      <Frame title="Configuração" width={width} footer="↑↓ navegar  ·  Enter mudar  ·  Esc fechar">
        {rows.map((r, i) => (
          <Text key={r.key} wrap="truncate">
            <Text color={i === panel.row ? 'cyan' : undefined} bold={i === panel.row}>{i === panel.row ? '❯ ' : '  '}{pad(r.label, 11)}</Text>
            <Text bold>{pad(r.value, 18)}</Text>
            <Text color={MUTED}>{r.hint}</Text>
          </Text>
        ))}
        {panel.status && <><Text> </Text><Text color="green">✓ {panel.status}</Text></>}
      </Frame>
    )
  }
  if (panel.kind === 'mcp') {
    if (panel.importList) {
      return (
        <Frame title="Importar do Claude Code" width={width} footer="↑↓ escolher  ·  Enter importar  ·  Esc voltar">
          {panel.importList.map((m, i) => (
            <Text key={m.nome} color={i === panel.picking ? 'cyan' : undefined} bold={i === panel.picking}>{i === panel.picking ? '❯ ' : '  '}{m.nome}</Text>
          ))}
          <Text> </Text>
          <Text color={MUTED}>Entra como só leitura, para todos. O Playwright entra desligado (os agentes Claude já usam o navegador do Tutti).</Text>
        </Frame>
      )
    }
    const rows = session.mcpView()
    return (
      <Frame title="MCPs" width={width} footer="↑↓ navegar  ·  Enter liga/desliga  ·  i importar do Claude Code  ·  Esc fechar">
        {rows.length ? rows.map((m, i) => (
          <Text key={m.id} wrap="truncate">
            <Text color={i === panel.row ? 'cyan' : undefined} bold={i === panel.row}>{i === panel.row ? '❯ ' : '  '}{pad(m.nome, 14)}</Text>
            <Text color={m.estado === 'ligado' ? 'green' : m.estado === 'com erro' ? 'red' : MUTED}>{pad(m.estado, 11)}</Text>
            <Text>{pad(m.modo, 15)}</Text>
            <Text color={MUTED}>{`${m.leitura} de leitura · ${m.escrita} de escrita`}{m.precisaDoApp ? '  · tem segredo: só funciona pelo app' : ''}</Text>
          </Text>
        )) : <Text color={MUTED}>Nenhum MCP ainda. Aperte i para importar do Claude Code, ou use /mcp add nome comando…</Text>}
        <Text> </Text>
        <Text color={MUTED}>Escrita só nos agentes Claude, com sua aprovação a cada uso. Para adicionar com segredo ou mudar quem usa, use o app.</Text>
        {panel.status && <><Text> </Text><Text color="green">✓ {panel.status}</Text></>}
      </Frame>
    )
  }
  if (panel.kind === 'history') {
    const rows = session.historyView()
    return (
      <Frame title="Conversas deste projeto" width={width} footer="↑↓ navegar  ·  Enter retomar  ·  Esc fechar">
        {rows.length ? rows.map((r, i) => (
          <Text key={r.index} wrap="truncate">
            <Text color={i === panel.row ? 'cyan' : undefined} bold={i === panel.row}>{i === panel.row ? '❯ ' : '  '}{pad(r.when, 13)}</Text>
            <Text>{r.title}</Text>
            <Text color={MUTED}>{`  · ${r.prompts} pedido(s)`}{r.current ? '  · atual' : ''}</Text>
          </Text>
        )) : <Text color={MUTED}>Nenhuma conversa ainda.</Text>}
      </Frame>
    )
  }
  if (panel.kind === 'agents') {
    const rows = session.agentsView()
    return (
      <Frame title="Time do perfil" width={width} footer="Esc ou Enter fecha  ·  /config muda os papéis">
        <Text color={MUTED}>{`  ${pad('Agente', 10)}${pad('IA', 13)}${pad('Modelo', 22)}${pad('Papel', 17)}Uso`}</Text>
        {rows.map(a => (
          <Text key={a.nome} wrap="truncate">{'  '}<Text bold>{pad(a.nome, 10)}</Text>{pad(a.ia, 13)}<Text color={MUTED}>{pad(a.modelo, 22)}</Text>{pad(a.papel, 17)}{a.uso}</Text>
        ))}
      </Frame>
    )
  }
  if (panel.kind === 'usage') {
    const u = session.usageView()
    return (
      <Frame title="Uso" width={width} footer="Esc ou Enter fecha">
        <Text bold>Gasto nesta conversa</Text>
        {u.gasto.length ? u.gasto.map(g => <Text key={g.nome}>{'  '}{pad(g.nome, 12)}{g.tokens} tokens</Text>) : <Text color={MUTED}>  nada ainda</Text>}
        <Text> </Text>
        <Text bold>Limites</Text>
        {u.limites.length ? u.limites.map(l => <Text key={l.ia}>{'  '}{pad(l.ia, 12)}{pad(l.uso, 7)}<Text color={MUTED}>volta {l.volta}</Text></Text>) : <Text color={MUTED}>  sem dado ainda</Text>}
      </Frame>
    )
  }
  return (
    <Frame title="Comandos e atalhos" width={width} footer="Esc ou Enter fecha">
      {COMMANDS.map(c => <Text key={c.name} wrap="truncate">{'  '}<Text color="cyan">{pad(`/${c.name}`, 11)}</Text><Text color={MUTED}>{c.desc}</Text></Text>)}
      <Text> </Text>
      <Text color={MUTED}>  ↑↓ navega menus e opções  ·  Tab completa o comando  ·  Esc fecha ou limpa  ·  Ctrl+C sai</Text>
    </Frame>
  )
}
