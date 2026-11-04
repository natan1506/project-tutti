// Autonomia em três níveis (design escritório-autonomia-vozes §4): quanto o agente faz sem perguntar ao Natan.

export type AutonomyLevel = 'ask_all' | 'accept_edits' | 'autonomous'

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = ['ask_all', 'accept_edits', 'autonomous']

export const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
  ask_all: 'Perguntar tudo',
  accept_edits: 'Aceitar edições',
  autonomous: 'Sozinho',
}

/** O comportamento de antes dos níveis. */
export const DEFAULT_AUTONOMY: AutonomyLevel = 'accept_edits'

export const isAutonomyLevel = (x: unknown): x is AutonomyLevel => typeof x === 'string' && (AUTONOMY_LEVELS as readonly string[]).includes(x)

/** Por que a política pediu aprovação; aparece no cartão. */
export type ApprovalReason = 'ask_all' | 'destructive' | 'outside' | 'network' | 'unknown'

export const APPROVAL_REASON_LABEL: Record<ApprovalReason, string> = {
  ask_all: 'você pediu para perguntar tudo',
  destructive: 'destrutivo ou irreversível',
  outside: 'fora do projeto',
  network: 'acesso à internet',
  unknown: 'comando que o Tutti não reconhece',
}
