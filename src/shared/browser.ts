import type { AgentId } from './agents'

// Navegador dentro do Tutti: uma aba por agente; você assiste e pode assumir.

export interface BrowserTab { agentId: AgentId; url: string; title: string; loading: boolean }
export interface BrowserState {
  tabs: BrowserTab[]
  active: AgentId | null
  /** Aba em que você assumiu; o agente dela espera até você devolver. */
  control: AgentId | null
  /** Presente quando um agente abriu aba nova ou chamou você: a interface mostra o navegador. */
  opened?: AgentId
}
export interface BrowserBounds { x: number; y: number; width: number; height: number }
export const EMPTY_BROWSER: BrowserState = { tabs: [], active: null, control: null }
