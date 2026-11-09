import type { AgentId } from './agents'

// Tipos da orquestração do time (spec §5.2–5.4).

export interface TriageScore { agentId: AgentId; score: number; line: string }
export interface Triage { scores: TriageScore[]; candidates: AgentId[]; big: boolean }
export type Decision = 'assumo' | 'assumo_com_ajuda' | 'nao_e_comigo' | 'sem_resposta'
export interface Confirmation { agentId: AgentId; decision: Decision; line: string; helper?: AgentId; redirect?: AgentId }
/** `paid`: o passo usa agente por API paga (o plano passa a exigir aprovação, spec custos-e-perfis §6). */
export interface TeamStep { agentId: AgentId; task: string; model?: string; areas: string[]; paid?: { provider: string } }
export interface Lineup { steps: TeamStep[]; big: boolean; summary: string }

/** O que o cérebro da esteira manda o executor fazer, e como saber que ficou pronto (spec tutti-terminal §3). */
export interface EsteiraPlan { tarefa: string; pronto: string }
export interface EsteiraReview { pronto: boolean; falta: string }
