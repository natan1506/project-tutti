// Menu de comandos do terminal (no estilo do Claude Code): ao digitar "/", a lista aparece e vai filtrando.

export interface CommandInfo { name: string; desc: string }

export const COMMANDS: CommandInfo[] = [
  { name: 'config', desc: 'Escolher quem é cérebro, executor, tester e reserva; autonomia e voltas' },
  { name: 'agents', desc: 'Ver o time do perfil: IA, modelo, papel e uso de cada um' },
  { name: 'usage', desc: 'Quanto cada agente gastou nesta conversa e quando cada limite volta' },
  { name: 'history', desc: 'Retomar uma conversa deste projeto (inclusive as do app)' },
  { name: 'new', desc: 'Começar uma conversa nova' },
  { name: 'clear', desc: 'Limpar a tela e começar uma conversa nova' },
  { name: 'undo', desc: 'Desfazer o último pedido (só em pasta com git)' },
  { name: 'stop', desc: 'Parar o time agora' },
  { name: 'help', desc: 'Ver os comandos e os atalhos de teclado' },
  { name: 'exit', desc: 'Fechar o Tutti (Ctrl+C também fecha)' },
]

/** Comandos que combinam com o que foi digitado: primeiro os que começam igual, depois os que contêm o trecho. */
export function matchCommands(input: string): CommandInfo[] {
  if (!input.startsWith('/') || /\s/.test(input)) return []
  const q = input.slice(1).toLowerCase()
  if (!q) return COMMANDS
  const starts = COMMANDS.filter(c => c.name.startsWith(q))
  const has = COMMANDS.filter(c => !c.name.startsWith(q) && c.name.includes(q))
  return [...starts, ...has]
}
