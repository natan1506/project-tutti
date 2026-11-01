import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AgentId } from '@shared/agents'
import type { RunEvent, RunStatus } from '@shared/events'
import type { ToolKind } from '@shared/agents'
import type { Conversation, Project, RunRow } from '@shared/models'
import type { LimitWindow, TokenUsage, WindowKind } from '@shared/usage'

export type { Conversation, Project, RunRow }

export interface Store {
  upsertProject(path: string): Project
  recentProjects(limit?: number): Project[]
  createConversation(projectId: string, title: string): Conversation
  listConversations(projectId: string): Conversation[]
  createRun(r: Omit<RunRow, 'status' | 'finishedAt' | 'sessionId' | 'parentRunId'> & { parentRunId?: string }): RunRow
  listChildren(parentRunId: string): RunRow[]
  finishRun(id: string, status: RunStatus, sessionId?: string): void
  getRun(id: string): RunRow | undefined
  appendEvent(runId: string, ev: RunEvent): void
  listRuns(conversationId: string): RunRow[]
  listEvents(runId: string): RunEvent[]
  listRunsByStatus(status: RunStatus): RunRow[]
  lastSessionFor(conversationId: string, agentId: AgentId): string | null
  markInterruptedRuns(): number
  projectPathForRun(runId: string): string | undefined
  recordUsage(runId: string, agentId: AgentId, tool: ToolKind, tokens: TokenUsage, at: number): void
  recordLimit(l: LimitWindow): void
  tokensSince(tool: ToolKind, since: number): TokenUsage
  tokensByRun(conversationId: string): { runId: string; agentId: AgentId; tool: ToolKind; tokens: TokenUsage }[]
  tokensByDay(days: number, now?: number): { day: string; projectPath: string; tool: ToolKind; tokens: TokenUsage }[]
  latestLimits(): LimitWindow[]
  close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, name TEXT NOT NULL, last_opened_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), agent_id TEXT NOT NULL, prompt TEXT NOT NULL,
  status TEXT NOT NULL, session_id TEXT, started_at INTEGER NOT NULL, finished_at INTEGER, has_checkpoint INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS usage (run_id TEXT NOT NULL, agent_id TEXT NOT NULL, tool TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL, reasoning INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS usage_tool_at ON usage (tool, at);
CREATE TABLE IF NOT EXISTS limits (tool TEXT NOT NULL, window TEXT NOT NULL, utilization REAL NOT NULL, resets_at INTEGER, at INTEGER NOT NULL,
  PRIMARY KEY (tool, window));
CREATE TABLE IF NOT EXISTS events (run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (run_id, seq));
`

type Row = Record<string, unknown>
const toProject = (r: Row): Project => ({ id: r.id as string, path: r.path as string, name: r.name as string, lastOpenedAt: r.last_opened_at as number })
const toConversation = (r: Row): Conversation => ({ id: r.id as string, projectId: r.project_id as string, title: r.title as string, createdAt: r.created_at as number })
const toRun = (r: Row): RunRow => ({
  id: r.id as string, conversationId: r.conversation_id as string, agentId: r.agent_id as AgentId, prompt: r.prompt as string,
  status: r.status as RunStatus, sessionId: (r.session_id as string | null) ?? null, startedAt: r.started_at as number,
  finishedAt: (r.finished_at as number | null) ?? null, hasCheckpoint: r.has_checkpoint === 1,
  parentRunId: (r.parent_run_id as string | null) ?? null,
})

export function openStore(file: string): Store {
  const db = new DatabaseSync(file)
  if (file !== ':memory:') db.exec('PRAGMA journal_mode=WAL')
  db.exec(SCHEMA)
  // Fase 3B: runs-filhos de um pedido de time.
  if (!(db.prepare('PRAGMA table_info(runs)').all() as Row[]).some(c => c.name === 'parent_run_id')) db.exec('ALTER TABLE runs ADD COLUMN parent_run_id TEXT')
  // Date.now() pode repetir dentro do mesmo milissegundo; o relógio do store nunca anda para trás nem empata.
  let last = 0
  const now = () => (last = Math.max(Date.now(), last + 1))

  return {
    upsertProject(path) {
      db.prepare(`INSERT INTO projects (id, path, name, last_opened_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET last_opened_at = excluded.last_opened_at`).run(randomUUID(), path, basename(path), now())
      return toProject(db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as Row)
    },
    recentProjects(limit = 10) {
      return (db.prepare('SELECT * FROM projects ORDER BY last_opened_at DESC LIMIT ?').all(limit) as Row[]).map(toProject)
    },
    createConversation(projectId, title) {
      const c: Conversation = { id: randomUUID(), projectId, title, createdAt: now() }
      db.prepare('INSERT INTO conversations (id, project_id, title, created_at) VALUES (?, ?, ?, ?)').run(c.id, projectId, title, c.createdAt)
      return c
    },
    listConversations(projectId) {
      return (db.prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Row[]).map(toConversation)
    },
    createRun(r) {
      db.prepare(`INSERT INTO runs (id, conversation_id, agent_id, prompt, status, started_at, has_checkpoint, parent_run_id)
        VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`).run(r.id, r.conversationId, r.agentId, r.prompt, r.startedAt, r.hasCheckpoint ? 1 : 0, r.parentRunId ?? null)
      return this.getRun(r.id)!
    },
    finishRun(id, status, sessionId) {
      db.prepare('UPDATE runs SET status = ?, session_id = COALESCE(?, session_id), finished_at = ? WHERE id = ?').run(status, sessionId ?? null, now(), id)
    },
    getRun(id) {
      const r = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined
      return r && toRun(r)
    },
    appendEvent(runId, ev) {
      db.prepare('INSERT INTO events (run_id, seq, json) VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE run_id = ?), ?)')
        .run(runId, runId, JSON.stringify(ev))
    },
    listChildren(parentRunId) {
      return (db.prepare('SELECT * FROM runs WHERE parent_run_id = ? ORDER BY started_at').all(parentRunId) as Row[]).map(toRun)
    },
    listRuns(conversationId) {
      return (db.prepare('SELECT * FROM runs WHERE conversation_id = ? ORDER BY started_at').all(conversationId) as Row[]).map(toRun)
    },
    listEvents(runId) {
      return (db.prepare('SELECT json FROM events WHERE run_id = ? ORDER BY seq').all(runId) as Row[]).map(r => JSON.parse(r.json as string) as RunEvent)
    },
    listRunsByStatus(status) {
      return (db.prepare('SELECT * FROM runs WHERE status = ?').all(status) as Row[]).map(toRun)
    },
    lastSessionFor(conversationId, agentId) {
      const r = db.prepare(`SELECT session_id FROM runs WHERE conversation_id = ? AND agent_id = ? AND status = 'done'
        AND session_id IS NOT NULL ORDER BY started_at DESC LIMIT 1`).get(conversationId, agentId) as Row | undefined
      return (r?.session_id as string | undefined) ?? null
    },
    markInterruptedRuns() {
      return Number(db.prepare("UPDATE runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'").run(now()).changes)
    },
    projectPathForRun(runId) {
      const r = db.prepare(`SELECT p.path FROM runs r JOIN conversations c ON c.id = r.conversation_id
        JOIN projects p ON p.id = c.project_id WHERE r.id = ?`).get(runId) as Row | undefined
      return r?.path as string | undefined
    },
    recordUsage(runId, agentId, tool, t, at) {
      db.prepare('INSERT INTO usage (run_id, agent_id, tool, input, output, cache_read, reasoning, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(runId, agentId, tool, t.input, t.output, t.cacheRead, t.reasoning, at)
    },
    recordLimit(l) {
      // Guarda só o mais recente por (ferramenta, janela).
      db.prepare(`INSERT INTO limits (tool, window, utilization, resets_at, at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tool, window) DO UPDATE SET utilization = excluded.utilization, resets_at = excluded.resets_at, at = excluded.at
        WHERE excluded.at >= limits.at`).run(l.tool, l.window, l.utilization, l.resetsAt ?? null, l.at)
    },
    tokensSince(tool, since) {
      const r = db.prepare(`SELECT COALESCE(SUM(input),0) i, COALESCE(SUM(output),0) o, COALESCE(SUM(cache_read),0) c, COALESCE(SUM(reasoning),0) r
        FROM usage WHERE tool = ? AND at >= ?`).get(tool, since) as Row
      return { input: Number(r.i), output: Number(r.o), cacheRead: Number(r.c), reasoning: Number(r.r) }
    },
    tokensByRun(conversationId) {
      return (db.prepare(`SELECT u.run_id, u.agent_id, u.tool, SUM(u.input) i, SUM(u.output) o, SUM(u.cache_read) c, SUM(u.reasoning) r
        FROM usage u JOIN runs ru ON ru.id = u.run_id WHERE ru.conversation_id = ? GROUP BY u.run_id, u.agent_id, u.tool ORDER BY MIN(ru.started_at)`)
        .all(conversationId) as Row[]).map(r => ({
        runId: r.run_id as string, agentId: r.agent_id as AgentId, tool: r.tool as ToolKind,
        tokens: { input: Number(r.i), output: Number(r.o), cacheRead: Number(r.c), reasoning: Number(r.r) },
      }))
    },
    tokensByDay(days, nowMs = Date.now()) {
      return (db.prepare(`SELECT date(u.at / 1000, 'unixepoch', 'localtime') day, p.path, u.tool, SUM(u.input) i, SUM(u.output) o, SUM(u.cache_read) c, SUM(u.reasoning) r
        FROM usage u JOIN runs ru ON ru.id = u.run_id JOIN conversations cv ON cv.id = ru.conversation_id JOIN projects p ON p.id = cv.project_id
        WHERE u.at >= ? GROUP BY day, p.path, u.tool ORDER BY day`).all(nowMs - days * 86_400_000) as Row[]).map(r => ({
        day: r.day as string, projectPath: r.path as string, tool: r.tool as ToolKind,
        tokens: { input: Number(r.i), output: Number(r.o), cacheRead: Number(r.c), reasoning: Number(r.r) },
      }))
    },
    latestLimits() {
      return (db.prepare('SELECT * FROM limits').all() as Row[]).map(r => ({
        tool: r.tool as ToolKind, window: r.window as WindowKind, utilization: Number(r.utilization),
        ...(r.resets_at != null ? { resetsAt: Number(r.resets_at) } : {}), at: Number(r.at),
      }))
    },
    close() { db.close() },
  }
}
