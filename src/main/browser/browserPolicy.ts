import type { AutonomyLevel } from '@shared/autonomy'

// Regras do navegador dos agentes, sem nada de Electron: quem decide o quê (tabela aprovada pelo Natan em 2026-11-06).

export const BROWSER_TOOL_PREFIX = 'mcp__navegador__'
export type BrowserAction = 'read' | 'open' | 'act'

/** Só páginas web comuns: nada de arquivo local, `javascript:`, protocolos de outros apps ou senha no endereço. */
export function urlAllowed(raw: string): boolean {
  try {
    const u = new URL(raw)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password
  } catch {
    return false
  }
}

export const siteOf = (raw: string): string => new URL(raw).hostname.replace(/^www\./, '')

export function hostApproved(host: string, approved: ReadonlySet<string>): boolean {
  for (const a of approved) if (host === a || host.endsWith(`.${a}`)) return true
  return false
}

export function decideBrowser(action: BrowserAction, level: AutonomyLevel, { approved }: { approved: boolean }): 'allow' | 'ask' {
  if (action === 'read' || level === 'autonomous') return 'allow'
  if (action === 'open') return approved ? 'allow' : 'ask'
  return level === 'accept_edits' && approved ? 'allow' : 'ask'
}

export interface FieldInfo { role?: string; name?: string; id?: string; type?: string; autocomplete?: string; placeholder?: string; label?: string }

const SENSITIVE_AUTOCOMPLETE = /(^|\s)(cc-|current-password|new-password|one-time-code)/i
const SENSITIVE_WORDS = /senha|password|passwd|pwd|cvv|cvc|credit.?card|card.?(number|num)|cart[aã]o|\bcpf\b|\bssn\b|api.?key|secret|\btoken\b/i

/** Campo onde o agente nunca digita, em nenhum nível de autonomia: quem preenche é você. */
export function isSensitiveField(f: FieldInfo): boolean {
  if (f.type?.toLowerCase() === 'password') return true
  if (f.autocomplete && SENSITIVE_AUTOCOMPLETE.test(f.autocomplete)) return true
  return [f.name, f.id, f.placeholder, f.label].some(v => !!v && SENSITIVE_WORDS.test(v))
}

export interface AxNode {
  nodeId: string; parentId?: string; childIds?: string[]; ignored?: boolean; backendDOMNodeId?: number
  role?: { value?: unknown }; name?: { value?: unknown }; value?: { value?: unknown }
}

const INTERACTIVE = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton', 'listbox'])
const SILENT = new Set(['generic', 'none', 'InlineTextBox', 'LineBreak', 'presentation', 'RootWebArea', 'WebArea'])

/** Árvore de acessibilidade em texto curto; o que dá para clicar ou preencher ganha uma referência (e1, e2…). */
export function axToText(nodes: AxNode[], max = 20_000): { text: string; refs: Map<string, number> } {
  const byId = new Map(nodes.map(n => [n.nodeId, n]))
  const refs = new Map<string, number>()
  const lines: string[] = []
  let size = 0, cut = false
  const walk = (n: AxNode, depth: number) => {
    if (cut) return
    const role = String(n.role?.value ?? ''), name = String(n.name?.value ?? '').trim()
    const value = n.value?.value == null ? '' : String(n.value.value)
    let next = depth
    if (!n.ignored && !(SILENT.has(role) && !(role === 'generic' && name)) && (name || INTERACTIVE.has(role))) {
      let ref = ''
      if (INTERACTIVE.has(role) && n.backendDOMNodeId !== undefined) {
        ref = `e${refs.size + 1}`
        refs.set(ref, n.backendDOMNodeId)
      }
      const line = `${'  '.repeat(Math.min(depth, 8))}${ref ? `[${ref}] ` : ''}${role === 'StaticText' ? `"${name}"` : `${role} "${name}"`}${value ? ` = "${value.slice(0, 200)}"` : ''}`
      if (size + line.length > max) { cut = true; return }
      lines.push(line)
      size += line.length + 1
      next = depth + 1
    }
    for (const id of n.childIds ?? []) { const c = byId.get(id); if (c) walk(c, next) }
  }
  const root = nodes.find(n => !n.parentId)
  if (root) walk(root, 0)
  if (cut) lines.push('… (página cortada: role a página e leia de novo para ver o resto)')
  return { text: lines.join('\n'), refs }
}

const LABEL: Record<string, (i: Record<string, unknown>) => string> = {
  abrir_pagina: i => `Abrindo ${String(i.url ?? '')}`,
  ler_pagina: () => 'Lendo a página',
  print_da_pagina: () => 'Tirando print da página',
  clicar: i => `Clicando em ${String(i.ref ?? '')}`,
  // O texto digitado não aparece no chat nem no histórico: pode ser dado pessoal.
  digitar: i => `Digitando em ${String(i.ref ?? '')}`,
  rolar: i => `Rolando para ${String(i.direcao ?? 'baixo')}`,
  voltar: () => 'Voltando à página anterior',
  chamar_usuario: () => 'Chamando você no navegador',
}

/** Como uma ação no navegador aparece no chat; `undefined` se a ferramenta não é do navegador. */
export function browserToolEvent(toolName: string, input: Record<string, unknown>): { name: string; summary: string } | undefined {
  if (!toolName.startsWith(BROWSER_TOOL_PREFIX)) return undefined
  const short = toolName.slice(BROWSER_TOOL_PREFIX.length)
  return { name: 'Navegador', summary: LABEL[short]?.(input) ?? short }
}
