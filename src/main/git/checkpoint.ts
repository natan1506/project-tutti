import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiffFile } from '@shared/events'
import type { UndoResult } from '@shared/models'
import { runGit } from './git'

export type { UndoResult }

// Pontos de restauração do spec §6.3: guardados só em refs próprias (refs/time/…),
// sem tocar em HEAD, branch, index ou stash do Natan.

const AUTHOR = { GIT_AUTHOR_NAME: 'Time', GIT_AUTHOR_EMAIL: 'time@local', GIT_COMMITTER_NAME: 'Time', GIT_COMMITTER_EMAIL: 'time@local' }

async function headExists(dir: string): Promise<boolean> {
  try {
    await runGit(dir, ['rev-parse', '--verify', '-q', 'HEAD'])
    return true
  } catch {
    return false
  }
}

/** Grava o working tree inteiro (rastreados + não rastreados, respeitando .gitignore) num commit em `ref`. */
export async function snapshot(dir: string, ref: string): Promise<string> {
  const env = { GIT_INDEX_FILE: join(tmpdir(), `time-index-${randomUUID()}`) }
  try {
    const hasHead = await headExists(dir)
    if (hasHead) await runGit(dir, ['read-tree', 'HEAD'], { env })
    await runGit(dir, ['add', '-A'], { env })
    const tree = (await runGit(dir, ['write-tree'], { env })).trim()
    const parent = hasHead ? ['-p', 'HEAD'] : []
    const sha = (await runGit(dir, ['commit-tree', tree, ...parent, '-m', 'time snapshot'], { env: { ...env, ...AUTHOR } })).trim()
    await runGit(dir, ['update-ref', ref, sha])
    return sha
  } finally {
    await rm(env.GIT_INDEX_FILE, { force: true })
  }
}

export async function diffBetween(dir: string, fromRef: string, toRef: string): Promise<DiffFile[]> {
  const numstat = await runGit(dir, ['diff', '--no-renames', '--numstat', '-z', fromRef, toRef])
  const nameStatus = (await runGit(dir, ['diff', '--no-renames', '--name-status', '-z', fromRef, toRef])).split('\0')
  const status = new Map<string, string>()
  for (let i = 0; i + 1 < nameStatus.length; i += 2) if (nameStatus[i]) status.set(nameStatus[i + 1], nameStatus[i])
  const files: DiffFile[] = []
  for (const rec of numstat.split('\0').filter(Boolean)) {
    const [added, removed, path] = rec.split('\t')
    const s = status.get(path)
    files.push({ path, added: added === '-' ? 0 : Number(added), removed: removed === '-' ? 0 : Number(removed), status: s === 'A' || s === 'D' ? s : 'M' })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export function patchBetween(dir: string, fromRef: string, toRef: string, paths?: string[]): Promise<string> {
  return runGit(dir, ['diff', '--no-renames', '--binary', fromRef, toRef, ...(paths?.length ? ['--', ...paths] : [])])
}

/** Desfaz só as mudanças entre os dois pontos, preservando o que mudou depois sem sobreposição. */
export async function undo(dir: string, fromRef: string, toRef: string, paths?: string[]): Promise<UndoResult> {
  const patch = await patchBetween(dir, fromRef, toRef, paths)
  if (!patch.trim()) return { ok: true }
  try {
    await runGit(dir, ['apply', '-R', '--check'], { input: patch })
  } catch (e) {
    return { ok: false, conflicts: parseConflicts((e as { stderr?: string }).stderr ?? '') }
  }
  await runGit(dir, ['apply', '-R'], { input: patch })
  return { ok: true }
}

function parseConflicts(stderr: string): string[] {
  const found = new Set<string>()
  for (const m of stderr.matchAll(/error: patch failed: (.+?):\d+/g)) found.add(m[1])
  for (const m of stderr.matchAll(/error: (.+?): (?:does not match index|already exists in working directory|No such file or directory|does not exist in index)/g)) found.add(m[1])
  return [...found].sort()
}
