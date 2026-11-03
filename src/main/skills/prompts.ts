import { toSkillMd, type SkillDraft } from '@shared/skills'

// Prompts de quem cria a skill (plano skills, Design §2 e §4).

const FORMAT = [
  'Formato da skill (um SKILL.md):',
  '---',
  'name: nome-em-kebab-case',
  'description: Uma frase dizendo QUANDO usar a skill (é o que o agente lê para decidir).',
  '---',
  '',
  'Instruções objetivas, em passos, para o agente seguir. Só texto: sem scripts nem arquivos extras.',
  '',
  'Devolva SÓ um bloco de código com a linguagem `skill` contendo o SKILL.md completo, assim:',
  '```skill',
  '---',
  'name: …',
  'description: …',
  '---',
  '…',
  '```',
].join('\n')

export function createPrompt(request: string): string {
  return [
    'Você vai escrever uma skill: instruções que outros agentes de programação vão seguir quando a tarefa combinar com ela.',
    `O que o Natan quer:\n${request.trim()}`,
    'Seja específico e curto; prefira passos verificáveis a conselhos gerais.',
    FORMAT,
  ].join('\n\n')
}

export function improvePrompt(i: { skill: SkillDraft; task: string; answer: string; feedback?: string }): string {
  return [
    'Você escreveu esta skill:',
    toSkillMd(i.skill),
    `Ela foi testada com a tarefa:\n${i.task.trim()}`,
    `Resposta do agente que usou a skill:\n${i.answer.trim() || '(sem resposta)'}`,
    i.feedback?.trim()
      ? `Comentário do Natan:\n${i.feedback.trim()}\n\nAjuste a skill para atender ao comentário.`
      : 'Sem comentário do Natan: avalie se a resposta seguiu a skill e se a skill levou a um bom resultado. Corrija o que faltou ou ficou ambíguo.',
    FORMAT,
  ].join('\n\n')
}
