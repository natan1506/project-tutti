import { Box, Text, useInput, usePaste } from 'ink'
import { useEffect, useReducer, useRef, useState } from 'react'
import { parseCommand, type ConfigKey } from './commands'
import { COMMANDS, matchCommands } from './menus'
import { placar } from './placar'
import type { PanelKind, SessionView } from './session'
import type { Line } from './lines'
import { mdLines, prefix } from './markdown'

// Tela do terminal (spec tutti-terminal §4), no estilo do Claude Code: placar no topo, conversa, caixa de texto com
// moldura, menu de comandos ao digitar "/", painéis navegáveis (/config, /agents, /history, /usage, /help) e
// aprovação com setas.

const ACCENT = '#8b6cf6'
const MUTED = 'gray'
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))

/** Últimas linhas que cabem em `room` linhas da tela, contando que linha longa quebra em várias (senão a tela passa da
 * janela e o terminal repete o quadro inteiro). */
export function fitLines<T extends { text: string; parts?: unknown[]; wrap?: boolean }>(lines: T[], width: number, room: number): T[] {
  const out: T[] = []
  let used = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    const rows = l.parts && !l.wrap ? 1 : Math.max(1, Math.ceil([...l.text].length / Math.max(10, width)))
    if (used + rows > room) break
    used += rows
    out.unshift(l)
  }
  return out
}

const PASTE_TOKEN = /\[Texto colado #(\d+) \+\d+ linhas?\]/g
const pasteToken = (n: number, text: string) => { const k = text.split('\n').length; return `[Texto colado #${n} +${k} ${k === 1 ? 'linha' : 'linhas'}]` }

/** Uma linha da tela por linha do texto; em linha com título (`head`), cor e negrito ficam só na primeira. */
export const PROMPT_BG = '#4a4a4a'

export function screenLines(lines: Line[], width = 100): Line[] {
  return lines.flatMap(l => (l.prompt ? promptRows(l.text, width) : l.md ? answerRows(l) : l.parts ? [l] : l.text.split('\n').map((t, i) => ({ ...l, text: t, ...(l.head && i > 0 ? { color: undefined, bold: false } : {}) }))))
}

/** Pedido como no Claude Code: fundo cinza na largura toda, ❯ na primeira linha, quebra na mão (o fundo vai até o fim). */
function promptRows(text: string, width: number): Line[] {
  const room = Math.max(10, width - 2)
  return text.split('\n').flatMap((l, i) => {
    const chunks = l.length ? Array.from({ length: Math.ceil(l.length / room) }, (_, k) => l.slice(k * room, (k + 1) * room)) : ['']
    return chunks.map((c, k) => { const t = `${i === 0 && k === 0 ? '❯ ' : '  '}${c}`.padEnd(width); return { text: t, parts: [{ text: t, bg: PROMPT_BG, color: 'white' }] } })
  })
}

/** Resposta em markdown; com `bullet`, ● na primeira linha e o resto alinhado com ela. */
function answerRows(l: Line): Line[] {
  const rows = mdLines(l.text)
  if (!l.bullet) return rows
  let first = true
  return rows.map(r => { if (r.text === '') return r; const p = first ? '● ' : '  '; first = false; return prefix(r, p) })
}

const PAD_X = 2
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const elapsed = (since: number) => { const s = Math.max(0, Math.round((Date.now() - since) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${s % 60}s` }

type Panel = { kind: PanelKind; row: number; picking: number | null; status?: string; importList?: { nome: string }[] }

export function App({ session, exit, width, height = 40, onWheel }: { session: SessionView; exit: () => void; width: number; height?: number; onWheel?: (fn: (d: number) => void) => () => void }) {
  // Quantas linhas da conversa acima do fim estão sendo vistas (0 = no fim, acompanhando).
  const [scroll, setScroll] = useState(0)
  useEffect(() => onWheel?.(d => setScroll(s => Math.max(0, s - d * 3))), [onWheel])
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const [input, setInput] = useState('')
  const [menuSel, setMenuSel] = useState(0)
  const [choice, setChoice] = useState(0)
  const [panel, setPanelState] = useState<Panel | null>(null)
  useEffect(() => session.subscribe(redraw), [session])
  // Enquanto o time trabalha, o indicador gira e o tempo conta.
  const busy = session.activity() !== null
  useEffect(() => { if (!busy) return; const t = setInterval(redraw, 150); return () => clearInterval(t) }, [busy])

  // Teclas chegam mais rápido que a tela redesenha: texto e painel vivem em refs, e o estado só redesenha.
  const typed = useRef('')
  const panelRef = useRef<Panel | null>(null)
  const sel = useRef(0)
  const type = (next: string) => { typed.current = next; setInput(next); sel.current = 0; setMenuSel(0) }
  const setPanel = (p: Panel | null) => { panelRef.current = p; setPanelState(p) }

  // Texto colado (como no Claude Code): vira um bloco na caixa e só é enviado, inteiro, no Enter.
  const pastes = useRef<string[]>([])
  const addPaste = (raw: string) => {
    const text = raw.replace(/\r\n|\r/g, '\n')
    if (!text.includes('\n') && text.length <= 300) return type(typed.current + text)
    pastes.current.push(text)
    type(typed.current + pasteToken(pastes.current.length, text))
  }
  const expand = (raw: string) => raw.replace(PASTE_TOKEN, (m, n) => pastes.current[Number(n) - 1] ?? m)
  usePaste(text => { if (!panelRef.current) addPaste(text) })

  const submit = async (typedText: string) => {
    const text = expand(typedText).trim()
    pastes.current = []
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
      if (ch === 't' && rows[p.row]) return setPanel({ ...p, status: session.toggleTesterFree(rows[p.row].id) })
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
    if (key.pageUp || key.pageDown) { setScroll(s => Math.max(0, s + (key.pageUp ? 10 : -10))); return }
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
    // Nova linha sem enviar, como no Claude Code: Shift+Enter (terminais com o protocolo kitty), Option+Enter ou \ + Enter.
    if (key.return && (key.shift || key.meta)) { type(`${typed.current}\n`); return }
    if (key.return && typed.current.endsWith('\\')) { type(`${typed.current.slice(0, -1)}\n`); return }
    if (key.return) {
      const text = typed.current
      const pick = matches[sel.current]
      type('')
      if (pending) { if (text.trim()) session.answer(expand(text)); pastes.current = []; return }
      setScroll(0)
      void submit(pick ? `/${pick.name}` : text)
      return
    }
    if (key.backspace || key.delete) {
      // Apaga o bloco colado inteiro, não um caractere dele.
      const m = typed.current.match(/\[Texto colado #\d+ \+\d+ linhas?\]$/)
      type(m ? typed.current.slice(0, -m[0].length) : typed.current.slice(0, -1))
      return
    }
    if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return
    if (!ch) return
    const body = ch.replace(/\r\n|\r/g, '\n')
    const nl = body.indexOf('\n')
    if (nl === -1) { type(typed.current + body); return }
    // Processo ocupado: letras e um Enter podem chegar num pedaço só ("fig\r") — isso envia.
    if (nl === body.length - 1) {
      const text = typed.current + body.slice(0, -1)
      if (text.endsWith('\\')) { type(`${text.slice(0, -1)}\n`); return }
      type('')
      if (pending) session.answer(expand(text))
      else void submit(text)
      return
    }
    // Várias linhas num pedaço só é colagem (terminal sem bracketed paste): nunca vira vários pedidos.
    addPaste(body.replace(/\n$/, ''))
  })

  const pl = placar(session.header(), session.esteiraAgents(), session.usage(), width, Date.now())
  const pending = session.pending()
  const matches = panel || pending ? [] : matchCommands(input)
  const below = panel ? 14 : matches.length ? matches.length + 1 : 1
  const inner = Math.max(20, width - 2 * PAD_X)
  const boxWidth = inner
  // Texto de aprovação/pergunta cabe em até 3 linhas da caixa; o plano em si já está na conversa.
  const cap = (s: string) => { const max = 3 * (inner - 4); const one = s.replace(/\s*\n\s*/g, ' · '); return one.length > max ? `${one.slice(0, max - 1)}…` : one }
  const pendingText = pending ? cap(pending.text) : ''
  const pendingRows = !pending ? 0 : pending.kind === 'question' ? Math.ceil(pendingText.length / inner) : pending.kind === 'plan' ? 6 : 6 + Math.ceil(pendingText.length / (inner - 4))
  const act = pending ? null : session.activity()
  // Caixa de entrada: 2 de borda + uma por linha digitada (e as que quebram).
  const inputRows = panel ? 0 : input.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil((l.length + 3) / Math.max(10, inner - 4))), 0)
  const room = Math.max(3, height - 1 - 2 - 2 - inputRows - below - pendingRows - (act ? 1 : 0))
  const all = screenLines(session.lines(), inner)
  const back = Math.min(scroll, Math.max(0, all.length - 1))
  const lines = fitLines(all.slice(0, all.length - back), inner, room - (back ? 1 : 0))

  // Tela cheia: placar fixo no topo, entrada fixa embaixo, conversa no meio (corta por cima o que não cabe).
  return (
    <Box flexDirection="column" height={height} paddingTop={1} paddingX={PAD_X}>
      <Text wrap="truncate">
        <Text bold>{pl.header}</Text>
        {pl.cells.map((c, i) => (
          <Text key={i}>{'   '}<Text bold>{c.nome}</Text> <Text color={c.color}>{c.text}</Text></Text>
        ))}
      </Text>
      <Text color={MUTED}>{'─'.repeat(inner)}</Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" justifyContent={lines.length < all.length - back ? 'flex-end' : 'flex-start'}>
      {lines.map((l, i) => (l.parts
        ? <Text key={i} wrap={l.wrap ? 'wrap' : 'truncate'}>{l.parts.map((x, j) => <Text key={j} {...(x.color ? { color: x.color } : {})} {...(x.bg ? { backgroundColor: x.bg } : {})} bold={!!x.bold} italic={!!x.italic}>{x.text}</Text>)}</Text>
        : <Text key={i} {...(l.color ? { color: l.color } : {})} bold={!!l.bold} wrap="wrap">{l.text || ' '}</Text>))}
      </Box>
      {back > 0 && <Text color={MUTED} wrap="truncate">{`  ↓ mais ${back} linhas abaixo  ·  role para baixo ou PgDn`}</Text>}

      {pending && pending.kind !== 'question' && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={boxWidth}>
          <Text color="yellow" bold>{pending.kind === 'plan' ? 'Aprovar o plano acima?' : 'Permitir?'}</Text>
          {pending.kind !== 'plan' && <Text wrap="wrap">{pendingText}</Text>}
          <Text> </Text>
          <Text color={choice === 0 ? 'cyan' : undefined}>{choice === 0 ? '❯ ' : '  '}1. {pending.kind === 'plan' ? 'Aprovar' : 'Permitir'}</Text>
          <Text color={choice === 1 ? 'cyan' : undefined}>{choice === 1 ? '❯ ' : '  '}2. {pending.kind === 'plan' ? 'Recusar' : 'Negar'}</Text>
        </Box>
      )}
      {pending?.kind === 'question' && <Text color="yellow" wrap="wrap">{pendingText}</Text>}
      {act && (
        <Text wrap="truncate">
          <Text color="cyan">{SPINNER[Math.floor(Date.now() / 120) % SPINNER.length]} </Text>
          <Text bold>{act.text}</Text>
          <Text color={MUTED}>{`  ·  ${elapsed(act.since)}${act.detail ? `  ·  ${act.detail}` : ''}  ·  /stop para parar`}</Text>
        </Text>
      )}

      {panel ? <PanelView panel={panel} session={session} width={boxWidth} /> : (
        <Box borderStyle="round" borderColor={MUTED} paddingX={1} width={boxWidth}>
          <Box flexDirection="column">
            {input.split('\n').map((l, i, all) => (
              <Text key={i}><Text color="cyan">{i ? '  ' : '› '}</Text>{l}{i === all.length - 1 && <Text inverse> </Text>}</Text>
            ))}
          </Box>
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
        <Text color={MUTED} wrap="truncate">  / comandos  ·  Shift+⏎ nova linha  ·  ↑↓ navegar  ·  Tab completar  ·  Esc limpar  ·  Ctrl+C sair</Text>
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
      <Frame title="MCPs" width={width} footer="↑↓ navegar  ·  Enter liga/desliga  ·  t libera tudo para o tester  ·  i importar do Claude Code  ·  Esc fechar">
        {rows.length ? rows.map((m, i) => (
          <Text key={m.id} wrap="truncate">
            <Text color={i === panel.row ? 'cyan' : undefined} bold={i === panel.row}>{i === panel.row ? '❯ ' : '  '}{pad(m.nome, 14)}</Text>
            <Text color={m.estado === 'ligado' ? 'green' : m.estado === 'com erro' ? 'red' : MUTED}>{pad(m.estado, 11)}</Text>
            <Text>{pad(m.modo, 15)}</Text>
            <Text color={MUTED}>{`${m.leitura} de leitura · ${m.escrita} de escrita`}{m.precisaDoApp ? '  · tem segredo: só funciona pelo app' : ''}</Text>
            {m.livre && <Text color="yellow">{`  · ${m.livre}`}</Text>}
          </Text>
        )) : <Text color={MUTED}>Nenhum MCP ainda. Aperte i para importar do Claude Code, ou use /mcp add nome comando…</Text>}
        <Text> </Text>
        <Text color={MUTED}>Escrita: nos agentes Claude com sua aprovação a cada uso; no tester, só se você liberar (t). Para adicionar com segredo ou mudar quem usa, use o app.</Text>
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
