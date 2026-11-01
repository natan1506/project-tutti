import type { AgentId, ToolKind } from '@shared/agents'
import type { AgentEvent } from '@shared/events'
import {
  DEFAULT_USAGE_SETTINGS, zeroTokens, type LimitWindow, type ToolUsageRow, type UsageSettings, type UsageSettingsPatch, type UsageSnapshot,
} from '@shared/usage'
import type { Store } from '../store/db'

// Painel de uso (spec custos-e-perfis §4): por ferramenta, quanto do limite da sessão já foi e quantos tokens.

const TOOLS: ToolKind[] = ['claude', 'codex', 'gemini', 'opencode']
const FIVE_HOURS = 5 * 3_600_000
const NO_LIMIT: ToolKind[] = ['opencode']   // modelos gratuitos: sem limite conhecido

interface Deps {
  store: Store
  now?: () => number
  emit(s: UsageSnapshot): void
  pollClaude?: () => Promise<LimitWindow[]>
}

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

export class UsageService {
  private now: () => number
  private lastEmit = -Infinity
  private pending?: NodeJS.Timeout
  private crossListeners: ((tool: ToolKind, row: ToolUsageRow, window: LimitWindow['window'], utilization: number) => void)[] = []

  constructor(private deps: Deps) {
    this.now = deps.now ?? Date.now
  }

  settings(): UsageSettings {
    return { ...DEFAULT_USAGE_SETTINGS, ...(this.deps.store.getSetting<UsageSettings>('usage') ?? {}) }
  }

  updateSettings(s: UsageSettingsPatch): void {
    const cur = this.settings()
    const perTool = { ...cur.perTool }
    for (const [k, v] of Object.entries(s.perTool ?? {})) {
      const next: Record<string, number | null | undefined> = { ...perTool[k as ToolKind], ...v }
      for (const key of Object.keys(next)) if (next[key] === null || next[key] === undefined) delete next[key]
      perTool[k as ToolKind] = next
    }
    this.deps.store.setSetting('usage', { ...cur, ...(s.alertAt !== undefined ? { alertAt: s.alertAt } : {}), perTool })
    this.push()
  }

  alertAt(tool: ToolKind): number {
    const s = this.settings()
    return s.perTool[tool]?.alertAt ?? s.alertAt
  }

  /** Registra quem quer saber quando uma ferramenta passa do limite (Task 5). */
  onCross(fn: UsageService['crossListeners'][number]): void {
    this.crossListeners.push(fn)
  }

  onEvent(_runId: string, _agentId: AgentId, ev: AgentEvent): void {
    if (ev.type !== 'usage' && ev.type !== 'limit') return
    const tool = ev.type === 'usage' ? ev.tool : ev.limit.tool
    const row = this.row(tool)
    if (row.alert) {
      const top = this.topWindow(tool)
      for (const fn of this.crossListeners) fn(tool, row, top?.window ?? 'estimated', top?.utilization ?? row.utilization ?? 0)
    }
    this.push()
  }

  private polling?: Promise<void>

  /** Uma consulta por vez: se a anterior ainda não voltou, espera por ela em vez de abrir outra. */
  pollOnce(): Promise<void> {
    this.polling ??= (async () => {
      const limits = await this.deps.pollClaude?.().catch(() => []) ?? []
      for (const l of limits) this.deps.store.recordLimit(l)
      if (limits.length) this.push()
    })().finally(() => { this.polling = undefined })
    return this.polling
  }

  startPolling(intervalMs = 5 * 60_000): () => void {
    void this.pollOnce()
    const t = setInterval(() => void this.pollOnce(), intervalMs)
    return () => clearInterval(t)
  }

  snapshot(): UsageSnapshot {
    return { rows: TOOLS.map(t => this.row(t)), at: this.now() }
  }

  /** Janelas oficiais ainda válidas (não resetadas) da ferramenta. */
  private live(tool: ToolKind): LimitWindow[] {
    const now = this.now()
    return this.deps.store.latestLimits().filter(l => l.tool === tool && (l.resetsAt === undefined || l.resetsAt > now))
  }

  private topWindow(tool: ToolKind): LimitWindow | undefined {
    return [...this.live(tool)].sort((a, b) => b.utilization - a.utilization)[0]
  }

  private row(tool: ToolKind): ToolUsageRow {
    const now = this.now()
    const live = this.live(tool)
    const five = live.find(l => l.window === 'five_hour')
    const since = five?.resetsAt ? five.resetsAt - FIVE_HOURS : startOfDay(now)
    const tokens = this.deps.store.tokensSince(tool, since) ?? zeroTokens()
    const alertAt = this.alertAt(tool)
    if (five) {
      return { tool, utilization: five.utilization, estimated: false, window: 'five_hour', resetsAt: five.resetsAt, tokens, alert: live.some(l => l.utilization >= alertAt) }
    }
    const ceiling = this.settings().perTool[tool]?.estimateCeilingTokens
    if (!NO_LIMIT.includes(tool) && ceiling) {
      const today = this.deps.store.tokensSince(tool, startOfDay(now))
      const utilization = Math.round(((today.input + today.output) / ceiling) * 100)
      return { tool, utilization, estimated: true, window: 'estimated', tokens: today, alert: utilization >= alertAt }
    }
    return { tool, utilization: null, estimated: false, window: null, tokens, alert: live.some(l => l.utilization >= alertAt) }
  }

  /** No máximo um snapshot por segundo. */
  private push(): void {
    const wait = this.lastEmit + 1000 - this.now()
    if (wait <= 0 && !this.pending) {
      this.lastEmit = this.now()
      this.deps.emit(this.snapshot())
      return
    }
    this.pending ??= setTimeout(() => {
      this.pending = undefined
      this.lastEmit = this.now()
      this.deps.emit(this.snapshot())
    }, Math.max(wait, 0))
  }
}
