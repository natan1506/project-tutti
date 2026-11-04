import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { ApprovalReason, AutonomyLevel } from '@shared/autonomy'

// Política de comandos do spec §6.4: o que roda sozinho e o que pede aprovação ao Natan,
// agora por nível de autonomia (design escritório-autonomia-vozes §4).

export type Decision = 'allow' | 'ask'
export interface ToolCall { toolName: string; input: Record<string, unknown> }
/** `sandboxed`: o agente roda os comandos no sandbox do macOS do Agent SDK (escrita só no projeto). */
export interface PolicyContext { level: AutonomyLevel; sandboxed: boolean }
export interface PolicyResult { decision: Decision; reason?: ApprovalReason }

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const FREE_TOOLS = new Set(['TodoWrite', 'Task'])
const PATH_KEYS = ['file_path', 'notebook_path', 'path'] as const

const READ_CMDS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'pwd', 'echo', 'grep', 'rg', 'find'])
const FIND_WRITE_FLAGS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'])
const GIT_DENY_FLAGS = /^--(output|ext-diff|textconv)(=|$)/
const RG_DENY_FLAGS = /^--pre(-glob)?(=|$)/
const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'branch'])
const SCRIPT_READ = new Set(['test', 'lint', 'build', 'typecheck'])
const NPX_READ = new Set(['tsc', 'vitest', 'eslint'])
// Internet: livre só no Sozinho. `SandboxNetworkAccess` é a rede pedida de dentro do sandbox (spike-sandbox).
const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch', 'SandboxNetworkAccess'])

/**
 * Destrutivo ou irreversível (§4.1): pede em todos os níveis. Olha o texto inteiro, para pegar o que vem
 * encadeado ou dentro de `$( )`/crases; na dúvida (ex.: dentro de aspas depois de `;`), pede.
 */
// Começo de palavra de comando: início, separadores, `$(`/crase, aspas (`bash -c "…"`), `\rm` e `/bin/rm`.
const S = String.raw`(?:^|[\s;&|(\x60$"'\\/])`
const DESTRUCTIVE: RegExp[] = [
  new RegExp(String.raw`${S}(?:rm|rmdir|sudo|chmod|chown|brew)(?=\s|$)`),
  new RegExp(String.raw`${S}git\s+(?:rm|clean|push|rebase|restore)\b`),
  // `git` com opções no meio (`git -C . push`, `git --no-pager push`).
  /\bgit\b[^;&|\n]*\spush\b/,
  new RegExp(String.raw`${S}git\s+reset\b[^;&|]*--hard`),
  new RegExp(String.raw`${S}git\s+checkout\s+(?:[^;&|]*\s)?--(?:\s|$)`),
  new RegExp(String.raw`${S}git\s+branch\b[^;&|]*\s-D\b`),
  new RegExp(String.raw`${S}find\b[^;&|]*\s-delete\b`),
  new RegExp(String.raw`${S}(?:npm|pnpm|yarn)\s+(?:i|install|add)\b[^;&|]*\s(?:-g|--global)\b`),
  new RegExp(String.raw`${S}yarn\s+global\b`),
  new RegExp(String.raw`${S}pip3?\s+install\b`),
  new RegExp(String.raw`${S}(?:curl|wget)\b[^;&]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b`),
]

export function isDestructive(command: string): boolean {
  return DESTRUCTIVE.some(re => re.test(command))
}

/** Uma decisão a partir do nível e do sandbox; `classifyToolCall` é o nível de antes ("Aceitar edições"). */
export function decide(call: ToolCall, projectDir: string, ctx: PolicyContext): PolicyResult {
  const { toolName, input } = call
  const ask = (reason: ApprovalReason): PolicyResult => ({ decision: 'ask', reason })
  if (FREE_TOOLS.has(toolName)) return { decision: 'allow' }
  if (NETWORK_TOOLS.has(toolName)) return ctx.level === 'autonomous' ? { decision: 'allow' } : ask('network')
  if (READ_TOOLS.has(toolName) || WRITE_TOOLS.has(toolName)) {
    if (classifyFileCall(call, projectDir) === 'ask') return ask('outside')
    return WRITE_TOOLS.has(toolName) && ctx.level === 'ask_all' ? ask('ask_all') : { decision: 'allow' }
  }
  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : ''
    if (isDestructive(command)) return ask('destructive')
    if (ctx.level === 'ask_all') return ask('ask_all')
    // Sozinho: qualquer comando roda, inclusive o que o Tutti não reconhece (decidido pelo Natan em 2026-11-04);
    // ler ou escrever fora do projeto pede em todos os níveis (§4.1). No sandbox as credenciais da home ficam ilegíveis.
    if (ctx.level === 'autonomous') return bashTouchesOutside(command, projectDir) ? ask('outside') : { decision: 'allow' }
    if (!hasShellMagic(command) && splitSegments(command).every(s => classifySegment(tokenize(s), projectDir) === 'allow'))
      return { decision: 'allow' }
    return ask(bashTouchesOutside(command, projectDir) ? 'outside' : 'unknown')
  }
  // Ferramenta que o Tutti não reconhece (Skill, BashOutput…): livre só no Sozinho.
  return ctx.level === 'autonomous' ? { decision: 'allow' } : ask('unknown')
}

export function isInside(projectDir: string, p: string): boolean {
  if (/^~[^/]/.test(p)) return false // ~usuario/… aponta para a home de outro usuário
  const abs = resolve(projectDir, p.replace(/^~(?=$|\/)/, homedir()))
  // Pelo caminho real: /var e /tmp no macOS são atalhos para /private/…, e um atalho dentro do projeto
  // pode apontar para fora (a escrita do Edit/Write não passa pelo sandbox).
  const root = realPath(projectDir), real = realPath(abs)
  return real === root || real.startsWith(root + sep)
}

/** Caminho real do trecho que existe, com o resto (arquivo ainda não criado) por cima. */
function realPath(p: string): string {
  let head = p
  const rest: string[] = []
  while (!existsSync(head) && dirname(head) !== head) { rest.unshift(basename(head)); head = dirname(head) }
  try {
    return join(realpathSync(head), ...rest)
  } catch {
    return p
  }
}

export function classifyToolCall(call: ToolCall, projectDir: string): Decision {
  return decide(call, projectDir, { level: 'accept_edits', sandboxed: false }).decision
}

/** Ler/escrever: tudo dentro do projeto (e escrita fora de `.git/`)? */
function classifyFileCall(call: ToolCall, projectDir: string): Decision {
  const { toolName, input } = call
  const paths = PATH_KEYS.map(k => input[k]).filter((v): v is string => typeof v === 'string')
  // Padrões de Glob/Grep também podem apontar para fora do projeto.
  const patterns = [toolName === 'Glob' ? input.pattern : undefined, toolName === 'Grep' ? input.glob : undefined]
    .filter((v): v is string => typeof v === 'string' && looksLikePath(v))
  // `.git` também pelo caminho real (um atalho `g -> .git` não escapa).
  if (WRITE_TOOLS.has(toolName) && paths.some(p => touchesGitDir(p) || touchesGitDir(relative(realPath(projectDir), realPath(resolve(projectDir, p)))))) return 'ask'
  return [...paths, ...patterns].every(p => isInside(projectDir, p)) ? 'allow' : 'ask'
}

function bashTouchesOutside(command: string, projectDir: string): boolean {
  return splitSegments(command).some(s => tokenize(s).some(t => looksLikePath(t) && !isInside(projectDir, t)))
}

export function summarizeToolCall(call: ToolCall, projectDir: string): string {
  if (call.toolName === 'Bash' && typeof call.input.command === 'string') return call.input.command
  for (const k of PATH_KEYS) {
    const p = call.input[k]
    if (typeof p === 'string') return isInside(projectDir, p) ? relative(projectDir, resolve(projectDir, p)) : p
  }
  return call.toolName
}

/**
 * Falha fechado diante de recursos do shell que o classificador não entende:
 * substituição de comando, variáveis, escapes, processos em segundo plano (`&` sozinho) e `<( )`.
 */
function hasShellMagic(command: string): boolean {
  const rest = command.replace(/&&/g, '').replace(/\d?>&\d/g, '').replace(/&>\/dev\/null/g, '')
  return /[`\\$&]|<\(|>\(/.test(rest)
}

/** Divide um comando de shell em segmentos por `&&`, `||`, `;`, `|` e quebras de linha, fora de aspas. */
function splitSegments(command: string): string[] {
  const out: string[] = []
  let cur = '', quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) { if (c === quote) quote = null; cur += c; continue }
    if (c === '"' || c === "'") { quote = c; cur += c; continue }
    if (c === ';' || c === '\n' || c === '|' || (c === '&' && command[i + 1] === '&')) {
      out.push(cur); cur = ''
      if ((c === '|' && command[i + 1] === '|') || c === '&') i++
      continue
    }
    cur += c
  }
  out.push(cur)
  return out.map(s => s.trim()).filter(Boolean)
}

// Redirecionamentos que não escrevem em arquivo: juntar stderr/stdout ou descartar em /dev/null.
const HARMLESS_REDIRECT = /^(?:\d?>&\d|&?\d?>\/dev\/null)$/

function tokenize(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
    .map(t => t.replace(/^(["'])(.*)\1$/, '$2'))
    .filter(t => !HARMLESS_REDIRECT.test(t))
}

function classifySegment(tokens: string[], projectDir: string): Decision {
  const [cmd, ...args] = tokens
  if (!cmd || cmd.includes('=') || tokens.some(t => t.includes('>') || t.includes('<'))) return 'ask'
  // Valores de opções `--x=valor` também são checados como caminho.
  const values = args.map(a => (a.startsWith('-') ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : '') : a)).filter(Boolean)
  const pathsInside = () => values.every(a => !looksLikePath(a) || isInside(projectDir, a))

  if (cmd === 'cd') return args.length === 1 && isInside(projectDir, args[0]) ? 'allow' : 'ask'
  // Criar pasta dentro do projeto é inofensivo (o Write já cria pastas); fora dele ou em .git, pergunta.
  if (cmd === 'mkdir') {
    const dirs = args.filter(a => !a.startsWith('-'))
    return dirs.length > 0 && args.every(a => !a.startsWith('-') || a === '-p') && dirs.every(d => isInside(projectDir, d) && !touchesGitDir(d)) ? 'allow' : 'ask'
  }
  if (READ_CMDS.has(cmd)) {
    if (cmd === 'find' && args.some(a => FIND_WRITE_FLAGS.has(a))) return 'ask'
    if (cmd === 'rg' && args.some(a => RG_DENY_FLAGS.test(a))) return 'ask'
    return pathsInside() ? 'allow' : 'ask'
  }
  if (cmd === 'git') {
    const [sub, ...rest] = args
    if (!GIT_READ.has(sub) || rest.some(a => GIT_DENY_FLAGS.test(a))) return 'ask'
    if (sub === 'branch' && rest.some(a => !a.startsWith('-') || /^-(d|D|m|M|c|C)$|^--(delete|move|copy)/.test(a))) return 'ask'
    return pathsInside() ? 'allow' : 'ask'
  }
  if (cmd === 'npm' || cmd === 'pnpm' || cmd === 'yarn') {
    const [sub, script] = args
    if (sub === 'test' || (sub === 'run' && SCRIPT_READ.has(script)) || (cmd === 'yarn' && SCRIPT_READ.has(sub))) return 'allow'
    return 'ask'
  }
  if (cmd === 'npx') {
    const [tool] = args
    if (NPX_READ.has(tool) || (tool === 'prettier' && args.includes('--check'))) return pathsInside() ? 'allow' : 'ask'
    return 'ask'
  }
  return 'ask'
}

/** Escrever em `.git/` (config, hooks, filtros) executaria código no próximo snapshot do app. */
function touchesGitDir(p: string): boolean {
  return p.split(/[\\/]/).some(seg => seg.toLowerCase() === '.git')
}

function looksLikePath(a: string): boolean {
  return a.startsWith('/') || a.startsWith('~') || a === '..' || a.startsWith('../') || a.includes('/../')
}
