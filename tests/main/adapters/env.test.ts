import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BLOCKED_ENV, safeEnv } from '../../../src/main/adapters/env'

const SET = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT', 'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL',
  'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_GEMINI_BASE_URL', 'OPENCODE_API_KEY', 'OPENCODE_CONFIG', 'OPENROUTER_API_KEY']

describe('safeEnv', () => {
  afterEach(() => { for (const k of SET) delete process.env[k]; delete process.env.EXTRA_X })

  it('remove todas as chaves e endpoints de API da lista', () => {
    for (const k of SET) process.env[k] = 'x'
    const env = safeEnv()
    for (const k of SET) { expect(BLOCKED_ENV.has(k)).toBe(true); expect(env).not.toHaveProperty(k) }
  })

  it('acrescenta as pastas dos CLIs instalados fora do PATH padrão', () => {
    const parts = safeEnv().PATH.split(':')
    expect(parts).toContain(join(homedir(), '.opencode/bin'))
    expect(parts).toContain(join(homedir(), '.local/bin'))
    expect(parts.filter(p => p === join(homedir(), '.local/bin'))).toHaveLength(1)
  })

  it('aceita regra extra de remoção', () => {
    process.env.EXTRA_X = '1'
    expect(safeEnv(k => k === 'EXTRA_X')).not.toHaveProperty('EXTRA_X')
  })
})
