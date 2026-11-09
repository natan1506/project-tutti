import { getAgent, type AgentId } from '@shared/agents'
import type { Confirmation, EsteiraPlan, TeamStep, Triage } from '@shared/team'

// Textos que o Bússola e os candidatos recebem (spec §5.2). Curtos de propósito: cada palavra custa limite.

const roster = (ids: AgentId[]) =>
  ids.map(id => { const a = getAgent(id); return `- ${a.id} (${a.nome}): ${a.funcao}` }).join('\n')

const coordName = (id?: AgentId) => (id ? getAgent(id).nome : 'Bússola')

export function triagePrompt(prompt: string, available: AgentId[], coordinator?: AgentId): string {
  return [
    `Você é o ${coordName(coordinator)}, coordenador de um time de agentes de programação. Faça a triagem deste pedido do Natan.`,
    `Pedido: """${prompt}"""`,
    'Agentes disponíveis:', roster(available),
    'Para CADA agente, dê uma nota de 0 a 100 (quanto ele é o certo para o pedido) e uma frase curta (até 80 caracteres) na voz dele, em português.',
    'Escolha de 2 a 3 candidatos. Marque `big: true` se o pedido mexe em muitos arquivos ou em algo estrutural (dependências, configuração, schema, organização de pastas).',
  ].join('\n\n')
}

export function confirmPrompt(agentId: AgentId, prompt: string, line: string, coordinator?: AgentId, ids: AgentId[] = []): string {
  return [
    `O ${coordName(coordinator)} indicou você (${getAgent(agentId).nome}) para este pedido do Natan e disse: "${line}".`,
    `Pedido: """${prompt}"""`,
    'Responda SOMENTE com um JSON numa linha, sem mais nada:',
    '{"decision":"assumo"|"assumo_com_ajuda"|"nao_e_comigo","line":"<uma frase sua, até 80 caracteres>","helper":"<id de quem precisa, se assumo_com_ajuda>","redirect":"<id de quem deveria fazer, se nao_e_comigo>"}',
    `Ids: ${ids.join(', ')}. Não leia nem altere arquivos agora.`,
  ].join('\n\n')
}

export function lineupPrompt(prompt: string, triage: Triage, confirmations: Confirmation[], available: AgentId[], coordinator?: AgentId): string {
  const reviewers = available.filter(id => getAgent(id).reviewer)
  const conf = confirmations.map(c => `- ${c.agentId}: ${c.decision}${c.helper ? ` (ajuda: ${c.helper})` : ''}${c.redirect ? ` (indica: ${c.redirect})` : ''} — "${c.line}"`).join('\n')
  return [
    `Você é o ${coordName(coordinator)}. Feche a escalação deste pedido com base na triagem e nas confirmações dos candidatos.`,
    `Pedido: """${prompt}"""`,
    'Agentes disponíveis:', roster(available),
    `Notas da triagem: ${triage.scores.map(s => `${s.agentId}=${s.score}`).join(', ')}`,
    'Confirmações:', conf || '(nenhuma)',
    'Monte os passos em ordem. Cada passo: agentId, tarefa clara, e `areas` = pastas ou arquivos que ele vai alterar (sempre preencha; [] só para quem só lê). '
      + 'Modelos: claude-haiku-5-5 para tarefa simples, claude-sonnet-5-5 para normal, claude-opus-5-5 para difícil (só agentes Claude). '
      + (reviewers.length ? `Inclua ${reviewers.join(' e ')} no fim para revisar quando houver código novo. ` : '')
      + '`summary` = uma frase sua para o Natan. `big` como na triagem.',
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

// Esteira (spec tutti-terminal §3): o cérebro escreve a tarefa e revisa; executor e tester recebem só o necessário.

export function esteiraPlanPrompt(prompt: string, cerebro: AgentId): string {
  return [
    `Você é o ${coordName(cerebro)}, o cérebro do time. Você não implementa: escreve para o executor exatamente o que fazer.`,
    `Pedido do Natan: """${prompt}"""`,
    'Leia o projeto só o necessário. Em `tarefa`: o que fazer, passo a passo, com os arquivos prováveis. Em `pronto`: um critério de pronto verificável (que teste ou comando prova que ficou certo).',
  ].join('\n\n')
}

export function executorPrompt(plan: EsteiraPlan, feedback?: string): string {
  return [
    `Tarefa: ${plan.tarefa}`,
    `Pronto quando: ${plan.pronto}`,
    feedback ? `Na revisão anterior faltou: ${feedback}\nCorrija isso.` : '',
    'Mexa só no necessário. No fim, diga em poucas linhas o que mudou.',
  ].filter(Boolean).join('\n\n')
}

export function testerPrompt(plan: EsteiraPlan, executorReport: string): string {
  return [
    `Valide esta tarefa: ${plan.tarefa}`,
    `Critério de pronto: ${plan.pronto}`,
    `O executor disse: """${executorReport || '(nada)'}"""`,
    'Rode os testes e o que mais for preciso para conferir. Não corrija código. Relate o que passou, o que falhou e onde.',
  ].join('\n\n')
}

export function reviewPrompt(prompt: string, plan: EsteiraPlan, executorReport: string, testerReport: string, cerebro: AgentId): string {
  return [
    `Você é o ${coordName(cerebro)}. Revise se o pedido do Natan ficou pronto.`,
    `Pedido: """${prompt}"""`,
    `Tarefa que você passou: ${plan.tarefa}`,
    `Critério de pronto: ${plan.pronto}`,
    `Executor: """${executorReport || '(nada)'}"""`,
    `Tester: """${testerReport || '(nada)'}"""`,
    'Se o critério foi atendido, `pronto: true` e `falta` vazio. Senão, `pronto: false` e em `falta` exatamente o que o executor ainda precisa fazer.',
  ].join('\n\n')
}
