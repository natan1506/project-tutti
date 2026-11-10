import type { ToolKind } from '@shared/agents'
import type { ToolStatus } from '@shared/models'
import type { UsageSource } from '@shared/usage'
import type { Line } from './lines'

// Checagem da primeira abertura e do /doctor: o que falta para o time trabalhar, com o comando que resolve,
// antes de a pessoa dar de cara com um erro no meio do pedido.

const NAME: Record<ToolKind, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Antigravity', opencode: 'opencode' }
const INSTALL: Record<ToolKind, string> = {
  claude: 'Instale o Claude Code (claude.com/claude-code) e rode `claude` para entrar.',
  codex: 'Instale com `npm install -g @openai/codex` e rode `codex login`.',
  gemini: 'Instale o Antigravity CLI (`agy`) e entre na sua conta.',
  opencode: 'Instale com `npm install -g opencode-ai`.',
}
const LOGIN: Record<ToolKind, string> = {
  claude: 'Rode `claude` e faça login.',
  codex: 'Rode `codex login`.',
  gemini: 'Rode `agy` e entre na sua conta.',
  opencode: 'Rode `opencode auth login`.',
}

const atLeast = (v: string, major: number, minor: number) => { const [a, b] = v.split('.').map(Number); return a > major || (a === major && b >= minor) }
const joinNames = (n: string[]) => (n.length > 1 ? `${n.slice(0, -1).join(', ')} e ${n.at(-1)}` : n[0])

/** `node`: versão do Node quando o tutti roda num Node comum (no app, `undefined`: o Node é o do Electron). */
export function checkupLines(o: { team: { nome: string; tool: UsageSource }[]; tools: Record<ToolKind, ToolStatus>; node?: string; git: boolean }): { ok: boolean; lines: Line[] } {
  const problems: Line[] = []
  if (o.node && !atLeast(o.node, 22, 13)) problems.push({ text: `⚠ Node ${o.node}: o Tutti precisa do 22.13 ou mais novo. Atualize em nodejs.org (ou \`brew upgrade node\`).`, color: 'yellow' })
  const tools = [...new Set(o.team.map(a => a.tool))].filter((t): t is ToolKind => t !== 'api')
  for (const t of tools) {
    const s = o.tools[t]
    if (s?.installed && s.loggedIn) continue
    const who = `${joinNames(o.team.filter(a => a.tool === t).map(a => a.nome))} (${NAME[t]})`
    problems.push({ text: `⚠ ${who}: ${s?.installed ? `falta entrar. ${LOGIN[t]}` : `não está instalado. ${INSTALL[t]}`}`, color: 'yellow' })
  }
  if (!o.git) problems.push({ text: '⚠ Pasta sem git: o /undo não funciona aqui (rode `git init` para ter).', color: 'yellow' })
  if (problems.length) return { ok: false, lines: problems }
  return { ok: true, lines: [{ text: `✓ Tudo pronto: ${joinNames(tools.map(t => NAME[t]))} instalados e logados.`, color: 'green' }] }
}
