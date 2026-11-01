import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { AgentDef, AgentId } from '@shared/agents'

// Spec §5.4: no meio do trabalho, um agente pode perguntar algo a quem o perfil marca como "pode ser consultado"
// (no Padrão, Radar e Lupa). Ferramenta própria do app, servida in-process ao Claude Agent SDK (spike da Fase 3B).

export type AskAgent = (to: AgentId, question: string) => Promise<string>

export const AGENT_CALL_TOOL = 'mcp__tutti__perguntar_ao_time'
export const agentCallShape = (ids: AgentId[]) => ({ agente: z.enum(ids as [string, ...string[]]), pergunta: z.string().min(1) })
export const AGENT_CALL_SHAPE = agentCallShape(['radar', 'lupa'])

export function agentCallHandler(ask: AskAgent) {
  return async (a: { agente: string; pergunta: string }) => ({ content: [{ type: 'text' as const, text: await ask(a.agente, a.pergunta) }] })
}

export function makeAgentCallTool(ask: AskAgent, targets?: AgentDef[]) {
  const list = targets?.length ? targets : null
  const desc = list
    ? `Pergunta algo a ${list.map(a => `${a.nome} (id ${a.id}: ${a.funcao})`).join(' ou ')}. Eles só leem e respondem.`
    : 'Pergunta algo ao Radar (pesquisa na web e em documentação) ou ao Lupa (revisão de código). Eles só leem e respondem.'
  return createSdkMcpServer({
    name: 'tutti',
    tools: [tool('perguntar_ao_time', desc, list ? agentCallShape(list.map(a => a.id)) : AGENT_CALL_SHAPE, agentCallHandler(ask))],
  })
}
