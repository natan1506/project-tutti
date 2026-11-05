import type { RunEvent } from '@shared/events'

export type BatchedEvent = { runId: string; ev: RunEvent }

/** Junta os eventos das execuções: atualizar a tela a cada pedacinho de texto trava a interface. */
export function createEventBatcher(flush: (items: BatchedEvent[]) => void, ms = 80) {
  let items: BatchedEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const send = () => {
    timer = undefined
    if (!items.length) return
    const out = items
    items = []
    flush(out)
  }
  return {
    push(runId: string, ev: RunEvent) {
      items.push({ runId, ev })
      timer ??= setTimeout(send, ms)
    },
    stop() {
      if (timer) clearTimeout(timer)
      send()
    },
  }
}
