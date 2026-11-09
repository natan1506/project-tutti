// Comandos da tela do terminal (spec tutti-terminal §4). Texto sem "/" vai para o time.

export type ConfigKey = 'cerebro' | 'executor' | 'tester' | 'reserva' | 'autonomia' | 'voltas' | 'perfil'
export type Command =
  | { kind: 'send'; text: string } | { kind: 'new' } | { kind: 'clear' } | { kind: 'help' } | { kind: 'stop' } | { kind: 'exit' } | { kind: 'usage' }
  | { kind: 'history'; index?: number } | { kind: 'undo' } | { kind: 'agents' }
  | { kind: 'config'; key?: ConfigKey; value?: string }
  | { kind: 'unknown'; name: string }

const SIMPLE = { new: 'new', clear: 'clear', help: 'help', stop: 'stop', exit: 'exit', usage: 'usage', undo: 'undo', agents: 'agents' } as const
/** Palavras soltas que são comando de terminal, não pedido ao time. */
const BARE: Record<string, Command> = { clear: { kind: 'clear' }, exit: { kind: 'exit' }, sair: { kind: 'exit' }, quit: { kind: 'exit' }, help: { kind: 'help' }, ajuda: { kind: 'help' } }
const KEYS: ConfigKey[] = ['cerebro', 'executor', 'tester', 'reserva', 'autonomia', 'voltas', 'perfil']

export function parseCommand(input: string): Command {
  const t = input.trim()
  if (!t.startsWith('/')) return BARE[t.toLowerCase()] ?? { kind: 'send', text: t }
  const [name, ...rest] = t.slice(1).split(/\s+/)
  if (name in SIMPLE) return { kind: SIMPLE[name as keyof typeof SIMPLE] }
  if (name === 'history') {
    const n = Number(rest[0])
    return rest.length && Number.isInteger(n) && n > 0 ? { kind: 'history', index: n } : { kind: 'history' }
  }
  if (name === 'config') {
    if (!rest.length) return { kind: 'config' }
    const key = rest[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() as ConfigKey
    if (!KEYS.includes(key)) return { kind: 'unknown', name: `config ${rest[0]}` }
    return rest.length > 1 ? { kind: 'config', key, value: rest.slice(1).join(' ') } : { kind: 'config', key }
  }
  return { kind: 'unknown', name }
}
