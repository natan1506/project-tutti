// Spec §6.2: um pedido por vez por projeto; os seguintes esperam em fila, na ordem de chegada.

interface Waiter { id: string; resolve: () => void; onPosition?: (pos: number) => void }

export class ProjectQueue {
  private lines = new Map<string, Waiter[]>()

  acquire(projectPath: string, id: string, onPosition?: (pos: number) => void): Promise<void> {
    const line = this.lines.get(projectPath) ?? []
    this.lines.set(projectPath, line)
    return new Promise(resolve => {
      line.push({ id, resolve, onPosition })
      const pos = line.length - 1
      if (pos === 0) resolve()
      else onPosition?.(pos)
    })
  }

  release(projectPath: string, id: string): void {
    const line = this.lines.get(projectPath)
    if (!line || line[0]?.id !== id) return
    line.shift()
    this.announce(line)
    line[0]?.resolve()
    if (!line.length) this.lines.delete(projectPath)
  }

  /** Tira da fila quem ainda não começou; quem está rodando não sai por aqui. */
  remove(projectPath: string, id: string): boolean {
    const line = this.lines.get(projectPath)
    const i = line?.findIndex(w => w.id === id) ?? -1
    if (!line || i <= 0) return false
    line.splice(i, 1)
    this.announce(line, i)
    return true
  }

  position(projectPath: string, id: string): number {
    return this.lines.get(projectPath)?.findIndex(w => w.id === id) ?? -1
  }

  private announce(line: Waiter[], from = 0): void {
    line.forEach((w, pos) => { if (pos >= from) w.onPosition?.(pos) })
  }
}
