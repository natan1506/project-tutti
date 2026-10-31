import type { AgentId } from './agents'

// Tipos da orquestração do time (spec §5.2–5.4).

export interface TriageScore { agentId: AgentId; score: number; line: string }
export interface Triage { scores: TriageScore[]; candidates: AgentId[]; big: boolean }
export type Decision = 'assumo' | 'assumo_com_ajuda' | 'nao_e_comigo' | 'sem_resposta'
export interface Confirmation { agentId: AgentId; decision: Decision; line: string; helper?: AgentId; redirect?: AgentId }
export interface TeamStep { agentId: AgentId; task: string; model?: string; areas: string[] }
export interface Lineup { steps: TeamStep[]; big: boolean; summary: string }
