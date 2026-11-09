import { z } from 'zod'
import type { AgentDef, ToolKind } from './agents'

// Perfis de agentes (spec custos-e-perfis §6): o "Padrão" é o time de sempre; os do Natan são criados do zero.

export type ProviderId = 'openrouter' | 'moonshotai' | 'openai' | 'anthropic' | 'google' | 'deepseek'
export const PROVIDERS: readonly { id: ProviderId; nome: string }[] = [
  { id: 'openrouter', nome: 'OpenRouter' },
  { id: 'moonshotai', nome: 'Kimi (Moonshot)' },
  { id: 'openai', nome: 'OpenAI' },
  { id: 'anthropic', nome: 'Anthropic' },
  { id: 'google', nome: 'Google' },
  { id: 'deepseek', nome: 'DeepSeek' },
]
export const providerName = (id: string) => PROVIDERS.find(p => p.id === id)?.nome ?? id

export type Transport = { kind: 'cli'; tool: ToolKind } | { kind: 'api'; provider: ProviderId }
export type Family = 'claude' | 'gpt' | 'gemini' | 'other'

export interface ProfileAgent {
  id: string
  nome: string
  /** O que o agente é e como trabalha. */
  prompt: string
  /** Descrição curta usada na triagem. */
  funcao: string
  readOnly: boolean
  /** Ausentes: herda do perfil. */
  transport?: Transport
  model?: string
  /** Entra no fim, depois de quem escreve (papel do Lupa). */
  reviewer: boolean
  /** Pode ser chamado no meio do trabalho (papel do Radar/Lupa); só agentes que só leem. */
  consultable: boolean
}

/** Papéis da esteira (spec tutti-terminal §3). */
export type EsteiraRole = 'cerebro' | 'executor' | 'tester' | 'reserva'
/** Ids de agentes do perfil em cada papel; `maxVoltas`: quantas vezes o cérebro devolve ao executor. */
export interface Esteira { cerebro: string; executor: string; tester: string; reserva?: string; maxVoltas: number }
export const DEFAULT_MAX_VOLTAS = 2

export interface Profile {
  id: string
  nome: string
  builtin: boolean
  defaults: { transport: Transport; model?: string }
  coordinatorId?: string
  agents: ProfileAgent[]
  /** Com esteira, o pedido de time segue cérebro → executor → tester → cérebro em vez da triagem. */
  esteira?: Esteira
}

export const MAX_AGENTS = 8
const PT = 'Responda sempre em português do Brasil.'
const SENSATO = 'Se faltar informação, assuma o mais sensato e diga qual suposição fez.'

export const PADRAO: Profile = {
  id: 'padrao', nome: 'Padrão', builtin: true, coordinatorId: 'bussola',
  defaults: { transport: { kind: 'cli', tool: 'claude' } },
  agents: [
    {
      id: 'bussola', nome: 'Bússola', readOnly: false, reviewer: false, consultable: false, model: 'claude-opus-5-5',
      funcao: 'Coordena: triagem, escalação, escolha de modelo, plano, notas, consolidação de lições',
      prompt: 'Você é o Bússola, coordenador de um time de agentes de programação. Você planeja, quebra tarefas e decide quem faz o quê.',
    },
    {
      id: 'forja', nome: 'Forja', readOnly: false, reviewer: false, consultable: false, model: 'claude-sonnet-5-5',
      funcao: 'Back-end, APIs, banco, testes',
      prompt: 'Você é o Forja, especialista em back-end: APIs, banco de dados e testes. Você é direto e entrega código testado, sem firula.',
    },
    {
      id: 'pincel', nome: 'Pincel', readOnly: false, reviewer: false, consultable: false, model: 'claude-sonnet-5-5',
      funcao: 'Front-end, UI, acessibilidade',
      prompt: 'Você é o Pincel, especialista em front-end: interface, responsividade e acessibilidade. Você cuida dos detalhes visuais.',
    },
    {
      id: 'radar', nome: 'Radar', readOnly: true, reviewer: false, consultable: true, transport: { kind: 'cli', tool: 'gemini' },
      funcao: 'Pesquisa (docs oficiais, referências)',
      prompt: `Você é o Radar, pesquisador do time. Você busca documentação oficial e referências confiáveis e cita as fontes. Você só lê e pesquisa: nunca crie ou altere arquivos e nunca rode comandos; responda direto no texto, sem montar plano de implementação. ${SENSATO}`,
    },
    {
      id: 'lupa', nome: 'Lupa', readOnly: true, reviewer: true, consultable: true, transport: { kind: 'cli', tool: 'codex' },
      funcao: 'Code review',
      prompt: `Você é o Lupa, revisor de código do time. Você só lê, nunca altera arquivos. Aponte problemas reais com arquivo e linha, sem implicância. ${SENSATO}`,
    },
    {
      id: 'curinga', nome: 'Curinga', readOnly: false, reviewer: false, consultable: false, transport: { kind: 'cli', tool: 'opencode' }, model: 'opencode/big-pickle',
      funcao: 'Tarefas gerais / modelos alternativos',
      prompt: `Você é o Curinga, generalista do time, pronto para qualquer tarefa. ${SENSATO}`,
    },
  ],
}

/**
 * Perfil "Trabalho" (spec tutti-terminal §7): criado uma vez para o Natan, editável. Claude pensa e revisa; Codex
 * implementa e testa (escreve só na pasta, sem rede); opencode é a reserva; o Antigravity fica de consulta.
 */
export const TRABALHO_SEED: Profile = {
  id: '', nome: 'Trabalho', builtin: false, coordinatorId: 'bussola',
  defaults: { transport: { kind: 'cli', tool: 'claude' } },
  esteira: { cerebro: 'bussola', executor: 'forja', tester: 'lupa', reserva: 'curinga', maxVoltas: DEFAULT_MAX_VOLTAS },
  agents: [
    {
      id: 'bussola', nome: 'Bússola', readOnly: false, reviewer: false, consultable: false, model: 'claude-opus-5-5',
      funcao: 'Cérebro: entende o pedido, escreve o que fazer e o critério de pronto, revisa o resultado',
      prompt: 'Você é o Bússola, o cérebro do time. Você não implementa: escreve exatamente o que precisa ser feito, com critério de pronto verificável, e revisa o que o executor e o tester entregaram.',
    },
    {
      id: 'forja', nome: 'Forja', readOnly: false, reviewer: false, consultable: false, transport: { kind: 'cli', tool: 'codex' },
      funcao: 'Executor: implementa a tarefa recebida',
      prompt: `Você é o Forja, executor do time. Implemente exatamente a tarefa recebida, sem ampliar o escopo, e rode os testes do que mexeu. No fim, diga em poucas linhas o que mudou e o que ficou de fora. ${SENSATO}`,
    },
    {
      id: 'lupa', nome: 'Lupa', readOnly: false, reviewer: false, consultable: false, transport: { kind: 'cli', tool: 'codex' },
      funcao: 'Tester: valida a tarefa contra o critério de pronto',
      prompt: 'Você é o Lupa, tester do time. Valide a tarefa contra o critério de pronto: rode os testes e o que mais for preciso para conferir. Não corrija código; relate o que passou, o que falhou e onde (arquivo e linha).',
    },
    {
      id: 'curinga', nome: 'Curinga', readOnly: false, reviewer: false, consultable: false, transport: { kind: 'cli', tool: 'opencode' }, model: 'opencode/big-pickle',
      funcao: 'Reserva: assume quando o executor ou o tester não está disponível',
      prompt: `Você é o Curinga, reserva do time, pronto para executar ou testar quando alguém faltar. ${SENSATO}`,
    },
    {
      id: 'radar', nome: 'Radar', readOnly: true, reviewer: false, consultable: true, transport: { kind: 'cli', tool: 'gemini' },
      funcao: 'Pesquisa (docs oficiais, referências)',
      prompt: `Você é o Radar, pesquisador do time. Você busca documentação oficial e referências confiáveis e cita as fontes. Você só lê e pesquisa: nunca crie ou altere arquivos e nunca rode comandos. ${SENSATO}`,
    },
  ],
}

const CLI_FAMILY: Record<ToolKind, Family> = { claude: 'claude', codex: 'gpt', gemini: 'gemini', opencode: 'other' }

/** Spec §6: Claude → Clawd; GPT/Codex → nuvem; Gemini → estrela; resto (Kimi, DeepSeek…) → bloco do opencode. */
export function familyOf(t: Transport, model?: string): Family {
  if (t.kind === 'cli') return CLI_FAMILY[t.tool]
  const s = `${model ?? ''}`.toLowerCase()
  if (/claude/.test(s)) return 'claude'
  if (/gemini/.test(s)) return 'gemini'
  if (/gpt|codex|(^|\/)o\d/.test(s)) return 'gpt'
  if (/kimi|moonshot|deepseek/.test(s)) return 'other'
  return t.provider === 'anthropic' ? 'claude' : t.provider === 'openai' ? 'gpt' : t.provider === 'google' ? 'gemini' : 'other'
}

export const isPaidApi = (def: Pick<AgentDef, 'transport'>): boolean => def.transport.kind === 'api'

const withPt = (prompt: string) => (prompt.includes(PT) ? prompt.trim() : `${prompt.trim()} ${PT}`)

export function resolveAgentDefs(p: Profile): AgentDef[] {
  const seen: Partial<Record<Family, number>> = {}
  return p.agents.map(a => {
    const transport = a.transport ?? p.defaults.transport
    const model = a.model ?? (a.transport ? undefined : p.defaults.model)
    const family = familyOf(transport, model)
    const shade = seen[family] ?? 0
    seen[family] = shade + 1
    return {
      id: a.id, nome: a.nome, funcao: a.funcao, persona: withPt(a.prompt), readOnly: a.readOnly,
      tool: transport.kind === 'cli' ? transport.tool : 'opencode',
      ...(model ? { defaultModel: model } : {}),
      transport, family, shade, profileId: p.id,
      reviewer: a.reviewer, consultable: a.consultable, coordinator: p.coordinatorId === a.id,
    }
  })
}

const TOOLS = ['claude', 'codex', 'gemini', 'opencode'] as const
const transportSchema = z.union([
  z.object({ kind: z.literal('cli'), tool: z.enum(TOOLS) }),
  z.object({ kind: z.literal('api'), provider: z.enum(PROVIDERS.map(p => p.id) as [ProviderId, ...ProviderId[]]) }),
])
const agentSchema = z.object({
  id: z.string().max(80), nome: z.string().max(40), prompt: z.string().max(8000), funcao: z.string().max(200),
  readOnly: z.boolean(), transport: transportSchema.optional(), model: z.string().max(200).optional(),
  reviewer: z.boolean(), consultable: z.boolean(),
})
const profileSchema = z.object({
  id: z.string().max(80), nome: z.string().max(60), builtin: z.boolean(),
  defaults: z.object({ transport: transportSchema, model: z.string().max(200).optional() }),
  coordinatorId: z.string().optional(), agents: z.array(agentSchema),
  esteira: z.object({
    cerebro: z.string(), executor: z.string(), tester: z.string(), reserva: z.string().optional(), maxVoltas: z.number().int().min(1).max(5),
  }).optional(),
})

/** Pela CLI do opencode o modelo só pode ser gratuito: senão a chave do Natan pagaria sem o agente estar marcado como pago. */
const paidViaCli = (t: Transport, model?: string) => t.kind === 'cli' && t.tool === 'opencode' && !!model?.trim() && !model.trim().startsWith('opencode/')

export function validateProfile(raw: unknown): { ok: true; profile: Profile } | { ok: false; errors: string[] } {
  const parsed = profileSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: ['Perfil inválido.'] }
  const p = parsed.data as Profile
  const errors: string[] = []
  if (!p.nome.trim()) errors.push('O perfil precisa de um nome.')
  if (p.agents.length === 0) errors.push('O perfil precisa de pelo menos um agente.')
  if (paidViaCli(p.defaults.transport, p.defaults.model)) errors.push('Configuração geral: pela CLI do opencode só modelos gratuitos (opencode/…).')
  if (p.agents.length > MAX_AGENTS) errors.push(`No máximo ${MAX_AGENTS} agentes por perfil.`)
  const names = new Set<string>()
  for (const a of p.agents) {
    const nome = a.nome.trim()
    if (!nome) { errors.push('Todo agente precisa de um nome.'); continue }
    if (names.has(nome.toLowerCase())) errors.push(`Já existe um agente chamado "${nome}".`)
    names.add(nome.toLowerCase())
    if (a.consultable && !a.readOnly) errors.push(`${nome}: só agentes que só leem podem ser consultados.`)
    const transport = a.transport ?? p.defaults.transport
    const model = a.model ?? (a.transport ? undefined : p.defaults.model)
    if (transport.kind === 'api' && !model?.trim()) errors.push(`${nome}: escolha o modelo do provedor.`)
    if (paidViaCli(transport, model)) errors.push(`${nome}: pela CLI do opencode só modelos gratuitos (opencode/…); modelo pago vai por API.`)
  }
  const ids = p.agents.map(a => a.id).filter(Boolean)
  if (new Set(ids).size !== ids.length) errors.push('Agentes com o mesmo id.')
  if (p.coordinatorId !== undefined) {
    const c = p.agents.find(a => a.id === p.coordinatorId)
    if (!c) errors.push('O coordenador precisa ser um agente do perfil.')
    else if (c.readOnly) errors.push('O coordenador precisa poder escrever.')
  }
  if (p.esteira) {
    const e = p.esteira
    const all = [e.cerebro, e.executor, e.tester, ...(e.reserva ? [e.reserva] : [])]
    if (all.some(id => !p.agents.some(a => a.id === id))) errors.push('A esteira aponta para um agente que não está no perfil.')
    else if ([e.executor, e.tester, e.reserva].includes(e.cerebro)) errors.push('O cérebro não pode também executar, testar ou ser a reserva.')
    else if ([e.executor, e.tester, e.reserva].some(id => id && p.agents.find(a => a.id === id)!.readOnly)) errors.push('Executor, tester e reserva da esteira precisam poder escrever.')
  }
  return errors.length ? { ok: false, errors } : { ok: true, profile: p }
}
