import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { AGENT_CALL_SHAPE, AGENT_CALL_TOOL, agentCallHandler, makeAgentCallTool } from '../../../src/main/team/agentCalls'

describe('perguntar_ao_time', () => {
  it('repassa agente e pergunta e devolve a resposta como texto', async () => {
    const ask = vi.fn(async () => 'Node 26 LTS')
    const out = await agentCallHandler(ask)({ agente: 'radar', pergunta: 'qual versão?' })
    expect(ask).toHaveBeenCalledWith('radar', 'qual versão?')
    expect(out).toEqual({ content: [{ type: 'text', text: 'Node 26 LTS' }] })
  })
  it('só aceita Radar e Lupa', () => {
    const schema = z.object(AGENT_CALL_SHAPE)
    expect(schema.safeParse({ agente: 'lupa', pergunta: 'x' }).success).toBe(true)
    expect(schema.safeParse({ agente: 'forja', pergunta: 'x' }).success).toBe(false)
  })
  it('servidor se chama tutti e a ferramenta tem o nome do spike', () => {
    expect(makeAgentCallTool(async () => '')).toMatchObject({ type: 'sdk', name: 'tutti' })
    expect(AGENT_CALL_TOOL).toBe('mcp__tutti__perguntar_ao_time')
  })
})
