import { homedir } from 'node:os'
import { relative, resolve, sep } from 'node:path'

// Política de comandos do spec §6.4: o que roda sozinho e o que pede aprovação ao Natan.

export type Decision = 'allow' | 'ask'
export interface ToolCall { toolName: string; input: Record<string, unknown> }

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const FREE_TOOLS = new Set(['TodoWrite', 'Task'])
const PATH_KEYS = ['file_path', 'notebook_path', 'path'] as const

const READ_CMDS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'pwd', 'echo', 'grep', 'rg', 'find'])
const FIND_WRITE_FLAGS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir'])
const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'branch'])
const SCRIPT_READ = new Set(['test', 'lint', 'build', 'typecheck'])
const NPX_READ = new Set(['tsc', 'vitest', 'eslint'])

export function isInside(projectDir: string, p: string): boolean {
  const abs = resolve(projectDir, p.replace(/^~(?=$|\/)/, homedir()))
  return abs === projectDir || abs.startsWith(projectDir + sep)
}

export function classifyToolCall(call: ToolCall, projectDir: string): Decision {
  const { toolName, input } = call
  if (FREE_TOOLS.has(toolName)) return 'allow'
  if (READ_TOOLS.has(toolName) || WRITE_TOOLS.has(toolName)) {
    const paths = PATH_KEYS.map(k => input[k]).filter((v): v is string => typeof v === 'string')
    return paths.every(p => isInside(projectDir, p)) ? 'allow' : 'ask'
  }
  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : ''
    return splitSegments(command).every(s => classifySegment(tokenize(s), projectDir) === 'allow') ? 'allow' : 'ask'
  }
  return 'ask'
}

export function summarizeToolCall(call: ToolCall, projectDir: string): string {
  if (call.toolName === 'Bash' && typeof call.input.command === 'string') return call.input.command
  for (const k of PATH_KEYS) {
    const p = call.input[k]
    if (typeof p === 'string') return isInside(projectDir, p) ? relative(projectDir, resolve(projectDir, p)) : p
  }
  return call.toolName
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
  const pathsInside = () => args.filter(a => !a.startsWith('-')).every(a => !looksLikePath(a) || isInside(projectDir, a))

  if (cmd === 'cd') return args.length === 1 && isInside(projectDir, args[0]) ? 'allow' : 'ask'
  if (READ_CMDS.has(cmd)) {
    if (cmd === 'find' && args.some(a => FIND_WRITE_FLAGS.has(a))) return 'ask'
    return pathsInside() ? 'allow' : 'ask'
  }
  if (cmd === 'git') {
    const [sub, ...rest] = args
    if (!GIT_READ.has(sub)) return 'ask'
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

function looksLikePath(a: string): boolean {
  return a.startsWith('/') || a.startsWith('~') || a === '..' || a.startsWith('../') || a.includes('/../')
}
