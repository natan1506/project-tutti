import type { ToolKind } from './agents'

// Uso das assinaturas (spec custos-e-perfis §4 e §9).

export interface TokenUsage { input: number; output: number; cacheRead: number; reasoning: number }
export type WindowKind = 'five_hour' | 'seven_day' | 'seven_day_model' | 'estimated'
/** Uso de uma janela de limite da assinatura, 0–100. */
export interface LimitWindow { tool: ToolKind; window: WindowKind; utilization: number; resetsAt?: number; at: number }

export const zeroTokens = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, reasoning: 0 })
export const addTokens = (a: TokenUsage, b: TokenUsage): TokenUsage =>
  ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, reasoning: a.reasoning + b.reasoning })

export interface ToolUsageRow {
  tool: ToolKind; utilization: number | null; estimated: boolean; window: WindowKind | null
  resetsAt?: number; tokens: TokenUsage; alert: boolean
}
export interface UsageSnapshot { rows: ToolUsageRow[]; at: number }
export interface UsageSettings { alertAt: number; perTool: Partial<Record<ToolKind, { alertAt?: number; estimateCeilingTokens?: number }>> }
/** Mudança nas configurações; null apaga o ajuste da ferramenta (volta ao geral). */
export interface UsageSettingsPatch { alertAt?: number; perTool?: Partial<Record<ToolKind, { alertAt?: number | null; estimateCeilingTokens?: number | null }>> }
export const DEFAULT_USAGE_SETTINGS: UsageSettings = { alertAt: 90, perTool: {} }
export interface UsageDetail {
  byRun: { runId: string; agentId: import('./agents').AgentId; tool: ToolKind; tokens: TokenUsage }[]
  byDay: { day: string; projectPath: string; tool: ToolKind; tokens: TokenUsage }[]
}
