import { describe, expect, it } from 'vitest'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeBrain, LINEUP_SCHEMA, TRIAGE_SCHEMA } from '../../../src/main/team/brain'

function fakeQuery(result: Record<string, unknown>) {
  const seen: { prompt: string; options: Options }[] = []
  const fn = ((p: { prompt: string; options: Options }) => {
    seen.push(p)
    return (async function* () { yield { type: 'system', subtype: 'init' }; yield { type: 'result', ...result } })()
  }) as never
  return { fn, seen }
}
const input = { cwd: '/p', prompt: 'Crie /health', available: ['forja', 'pincel'] as const, signal: new AbortController().signal }

describe('ClaudeBrain', () => {
  it('triagem: JSON por esquema, sem ferramentas, modelo sonnet, lê structured_output', async () => {
    const q = fakeQuery({ subtype: 'success', structured_output: { scores: [], candidates: [], big: false } })
    const out = await new ClaudeBrain(q.fn).triage({ ...input, available: [...input.available] })
    expect(out).toEqual({ scores: [], candidates: [], big: false })
    const o = q.seen[0].options
    expect(o.outputFormat).toEqual({ type: 'json_schema', schema: TRIAGE_SCHEMA })
    expect(o.model).toBe('claude-sonnet-5-5')
    for (const t of ['Write', 'Edit', 'Bash', 'Read']) expect(o.disallowedTools).toContain(t)
    expect(o).toMatchObject({ settingSources: [], strictMcpConfig: true, mcpServers: {}, plugins: [] })
    expect(q.seen[0].prompt).toContain('Crie /health')
  })

  it('escalação usa o esquema da escalação', async () => {
    const q = fakeQuery({ subtype: 'success', structured_output: { steps: [] } })
    await new ClaudeBrain(q.fn).lineup({ ...input, available: [...input.available], triage: { scores: [], candidates: [], big: false }, confirmations: [] })
    expect(q.seen[0].options.outputFormat).toEqual({ type: 'json_schema', schema: LINEUP_SCHEMA })
  })

  it('falha de saída estruturada vira exceção', async () => {
    const q = fakeQuery({ subtype: 'error_max_structured_output_retries' })
    await expect(new ClaudeBrain(q.fn).triage({ ...input, available: [...input.available] })).rejects.toThrow(/error_max_structured_output_retries/)
  })
})
