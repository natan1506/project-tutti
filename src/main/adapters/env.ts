import { homedir } from 'node:os'
import { join } from 'node:path'

// Ambiente dos processos dos agentes: só a assinatura do Natan (spec §2) e os CLIs que ele instalou fora do PATH padrão.

export const BLOCKED_ENV: ReadonlySet<string> = new Set([
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'CODEX_HOME',
  'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_LOCATION', 'GOOGLE_GEMINI_BASE_URL',
  'OPENCODE_API_KEY', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT',
  'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'MISTRAL_API_KEY', 'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'TOGETHER_API_KEY',
])

/** Antigravity (`agy`) mora em ~/.local/bin e o opencode em ~/.opencode/bin; o app aberto pelo Finder não herda esses PATHs. */
export function toolPath(base = process.env.PATH ?? ''): string {
  const extra = [join(homedir(), '.local/bin'), join(homedir(), '.opencode/bin'), '/usr/local/bin', '/opt/homebrew/bin']
  const parts = base.split(':').filter(Boolean)
  return [...parts, ...extra.filter(p => !parts.includes(p))].join(':')
}

export function safeEnv(extraDrop: (k: string) => boolean = () => false): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !BLOCKED_ENV.has(k) && !extraDrop(k)) env[k] = v
  env.PATH = toolPath(env.PATH)
  return env
}
