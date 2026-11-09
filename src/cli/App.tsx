import { Box, Text, useInput } from 'ink'
import { useEffect, useReducer, useRef, useState } from 'react'
import { parseCommand } from './commands'
import { placar } from './placar'
import type { SessionView } from './session'

// Tela do terminal (spec tutti-terminal §4): placar numa linha no topo, conversa, pendência e caixa de texto.

const HELP = '/config  /agents  /usage  /history  /new  /undo  /stop  /exit'

export function App({ session, exit, width, height = 40 }: { session: SessionView; exit: () => void; width: number; height?: number }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const [input, setInput] = useState('')
  useEffect(() => session.subscribe(redraw), [session])

  const submit = async (raw: string) => {
    const text = raw.trim()
    if (session.pending()) { if (text) session.answer(text); return }
    if (!text) return
    const r = await session.run(parseCommand(text))
    if (r.exit) return exit()
    if (r.message) session.say(r.message, 'gray')
  }

  // O texto vive numa ref: teclas chegam mais rápido que a tela redesenha, e o Enter precisa do valor de agora.
  const typed = useRef('')
  const type = (next: string) => { typed.current = next; setInput(next) }
  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') { exit(); return }
    if (key.return) { const text = typed.current; type(''); void submit(text); return }
    if (key.backspace || key.delete) { type(typed.current.slice(0, -1)); return }
    if (key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return
    if (!ch) return
    // Processo ocupado: letras e Enter podem chegar num pedaço só ("fig\r"); cada quebra de linha envia.
    const parts = ch.split(/\r\n|\r|\n/)
    for (let i = 0; i < parts.length - 1; i++) { const text = typed.current + parts[i]; type(''); void submit(text) }
    type(typed.current + parts.at(-1)!)
  })

  const p = placar(session.header(), session.esteiraAgents(), session.usage(), width, Date.now())
  const pending = session.pending()
  const room = Math.max(3, height - 6 - (pending ? 1 : 0))
  const lines = session.lines().flatMap(l => l.text.split('\n').map(t => ({ ...l, text: t }))).slice(-room)

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text bold>{p.header}</Text>
        {p.cells.map((c, i) => (
          <Text key={i}>{'   '}<Text bold>{c.nome}</Text> <Text color={c.color}>{c.text}</Text></Text>
        ))}
      </Text>
      <Text color="gray">{'─'.repeat(Math.max(10, width))}</Text>
      {lines.map((l, i) => <Text key={i} {...(l.color ? { color: l.color } : {})} wrap="wrap">{l.text}</Text>)}
      {pending && <Text color="yellow">{pending.text} {pending.kind === 'question' ? '(responda e Enter)' : '[s/n]'}</Text>}
      <Text><Text color="cyan">›</Text> {input}</Text>
      <Text color="gray">{HELP}</Text>
    </Box>
  )
}
