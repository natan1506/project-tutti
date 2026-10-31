import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AgentId } from '@shared/agents'
import type { RunEvent, RunStatus } from '@shared/events'
import type { Conversation, Project, RunRow } from '@shared/models'

export type { Conversation, Project, RunRow }

export interface Store {
  upsertProject(path: string): Project
  recentProjects(limit?: number): Project[]
  createConversation(projectId: string, title: string): Conversation
  listConversations(projectId: string): Conversation[]
  createRun(r: Omit<RunRow, 'status' | 'finishedAt' | 'sessionId'>): RunRow
  finishRun(id: string, status: RunStatus, sessionId?: string): void
  getRun(id: string): RunRow | undefined
  appendEvent(runId: string, ev: RunEvent): void
  listRuns(conversationId: string): RunRow[]
  listEvents(runId: string): RunEvent[]
  markInterruptedRuns(): number
  projectPathForRun(runId: string): string | undefined
  close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, name TEXT NOT NULL, last_opened_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), agent_id TEXT NOT NULL, prompt TEXT NOT NULL,
  status TEXT NOT NULL, session_id TEXT, started_at INTEGER NOT NULL, finished_at INTEGER, has_checkpoint INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (run_id, seq));
`

type Row = Record<string, unknown>
const toProject = (r: Row): Project => ({ id: r.id as string, path: r.path as string, name: r.name as string, lastOpenedAt: r.last_opened_at as number })
const toConversation = (r: Row): Conversation => ({ id: r.id as string, projectId: r.project_id as string, title: r.title as string, createdAt: r.created_at as number })
const toRun = (r: Row): RunRow => ({
  id: r.id as string, conversationId: r.conversation_id as string, agentId: r.agent_id as AgentId, prompt: r.prompt as string,
  status: r.status as RunStatus, sessionId: (r.session_id as string | null) ?? null, startedAt: r.started_at as number,
  finishedAt: (r.finished_at as number | null) ?? null, hasCheckpoint: r.has_checkpoint === 1,
})

export function openStore(file: string): Store {
  const db = new DatabaseSync(file)
  if (file !== ':memory:') db.exec('PRAGMA journal_mode=WAL')
  db.exec(SCHEMA)
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
      db.prepare(`INSERT INTO runs (id, conversation_id, agent_id, prompt, status, started_at, has_checkpoint)
        VALUES (?, ?, ?, ?, 'running', ?, ?)`).run(r.id, r.conversationId, r.agentId, r.prompt, r.startedAt, r.hasCheckpoint ? 1 : 0)
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
    listRuns(conversationId) {
      return (db.prepare('SELECT * FROM runs WHERE conversation_id = ? ORDER BY started_at').all(conversationId) as Row[]).map(toRun)
    },
    listEvents(runId) {
      return (db.prepare('SELECT json FROM events WHERE run_id = ? ORDER BY seq').all(runId) as Row[]).map(r => JSON.parse(r.json as string) as RunEvent)
    },
    markInterruptedRuns() {
      return Number(db.prepare("UPDATE runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'").run(now()).changes)
    },
    projectPathForRun(runId) {
      const r = db.prepare(`SELECT p.path FROM runs r JOIN conversations c ON c.id = r.conversation_id
        JOIN projects p ON p.id = c.project_id WHERE r.id = ?`).get(runId) as Row | undefined
      return r?.path as string | undefined
    },
    close() { db.close() },
  }
}
