import { AGENTS, getAgent, type AgentId } from '@shared/agents'
import type { Confirmation, TeamStep, Triage } from '@shared/team'

// Textos que o Bússola e os candidatos recebem (spec §5.2). Curtos de propósito: cada palavra custa limite.

const roster = (ids: AgentId[]) =>
  ids.map(id => { const a = getAgent(id); return `- ${a.id} (${a.nome}): ${a.funcao}` }).join('\n')

export function triagePrompt(prompt: string, available: AgentId[]): string {
  return [
    'Você é o Bússola, coordenador de um time de agentes de programação. Faça a triagem deste pedido do Natan.',
    `Pedido: """${prompt}"""`,
    'Agentes disponíveis:', roster(available),
    'Para CADA agente, dê uma nota de 0 a 100 (quanto ele é o certo para o pedido) e uma frase curta (até 80 caracteres) na voz dele, em português.',
    'Escolha de 2 a 3 candidatos. Marque `big: true` se o pedido mexe em muitos arquivos ou em algo estrutural (dependências, configuração, schema, organização de pastas).',
  ].join('\n\n')
}

export function confirmPrompt(agentId: AgentId, prompt: string, line: string): string {
  return [
    `O Bússola indicou você (${getAgent(agentId).nome}) para este pedido do Natan e disse: "${line}".`,
    `Pedido: """${prompt}"""`,
    'Responda SOMENTE com um JSON numa linha, sem mais nada:',
    '{"decision":"assumo"|"assumo_com_ajuda"|"nao_e_comigo","line":"<uma frase sua, até 80 caracteres>","helper":"<id de quem precisa, se assumo_com_ajuda>","redirect":"<id de quem deveria fazer, se nao_e_comigo>"}',
    `Ids: ${AGENTS.map(a => a.id).join(', ')}. Não leia nem altere arquivos agora.`,
  ].join('\n\n')
}

export function lineupPrompt(prompt: string, triage: Triage, confirmations: Confirmation[], available: AgentId[]): string {
  const conf = confirmations.map(c => `- ${c.agentId}: ${c.decision}${c.helper ? ` (ajuda: ${c.helper})` : ''}${c.redirect ? ` (indica: ${c.redirect})` : ''} — "${c.line}"`).join('\n')
  return [
    'Você é o Bússola. Feche a escalação deste pedido com base na triagem e nas confirmações dos candidatos.',
    `Pedido: """${prompt}"""`,
    'Agentes disponíveis:', roster(available),
    `Notas da triagem: ${triage.scores.map(s => `${s.agentId}=${s.score}`).join(', ')}`,
    'Confirmações:', conf || '(nenhuma)',
    'Monte os passos em ordem. Cada passo: agentId, tarefa clara, e `areas` = pastas ou arquivos que ele vai alterar (sempre preencha; [] só para quem só lê). '
      + 'Modelos: claude-haiku-5-5 para tarefa simples, claude-sonnet-5-5 para normal, claude-opus-5-5 para difícil (só agentes Claude). '
      + 'Inclua o lupa no fim para revisar quando houver código novo. `summary` = uma frase sua para o Natan. `big` como na triagem.',
  ].join('\n\n')
}

export function childPrompt(step: TeamStep, prompt: string, others: TeamStep[]): string {
  return [
    `Sua parte neste pedido do time: ${step.task}`,
    step.areas.length ? `Mexa só em: ${step.areas.join(', ')}.` : '',
    `Pedido original do Natan: """${prompt}"""`,
    others.length ? `Trabalhando ao mesmo tempo: ${others.map(o => `${getAgent(o.agentId).nome} (${o.areas.join(', ') || 'só leitura'})`).join('; ')}. Não mexa nas áreas deles.` : '',
  ].filter(Boolean).join('\n\n')
}
