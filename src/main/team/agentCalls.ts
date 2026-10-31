import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// Spec §5.4: no meio do trabalho, um agente pode perguntar algo ao Radar (pesquisa) ou ao Lupa (revisão).
// Ferramenta própria do app, servida in-process ao Claude Agent SDK (spike da Fase 3B).

export type AskAgent = (to: 'radar' | 'lupa', question: string) => Promise<string>

export const AGENT_CALL_TOOL = 'mcp__tutti__perguntar_ao_time'
export const AGENT_CALL_SHAPE = { agente: z.enum(['radar', 'lupa']), pergunta: z.string().min(1) }

export function agentCallHandler(ask: AskAgent) {
  return async (a: { agente: 'radar' | 'lupa'; pergunta: string }) => ({ content: [{ type: 'text' as const, text: await ask(a.agente, a.pergunta) }] })
}

export function makeAgentCallTool(ask: AskAgent) {
  return createSdkMcpServer({
    name: 'tutti',
    tools: [tool('perguntar_ao_time', 'Pergunta algo ao Radar (pesquisa na web e em documentação) ou ao Lupa (revisão de código). Eles só leem e respondem.',
      AGENT_CALL_SHAPE, agentCallHandler(ask))],
  })
}
