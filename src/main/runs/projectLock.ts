import type { Store } from '../store/db'
import { pidAlive } from '../store/pid'

// Um pedido por vez por projeto também entre processos (app e terminal no mesmo banco).
// A fila em memória ordena quem é deste processo; esta trava decide entre processos.

export function tryLock(db: Store, path: string, owner: string, pid = process.pid, isAlive: (pid: number) => boolean = pidAlive): boolean {
  return db.lockProject(path, owner, pid, isAlive)
}

/** Espera a trava; false se o sinal abortar antes. */
export async function waitLock(db: Store, path: string, owner: string, signal: AbortSignal, pollMs = 250): Promise<boolean> {
  while (!signal.aborted) {
    if (tryLock(db, path, owner)) return true
    await new Promise<void>(r => {
      const t = setTimeout(r, pollMs)
      signal.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true })
    })
  }
  return false
}

export function unlock(db: Store, path: string, owner: string): void {
  db.unlockProject(path, owner)
}
