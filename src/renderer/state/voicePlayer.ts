import { VoiceQueue, type SpeechItem, type SynthResult } from '@shared/voice'

// Uma fala por vez, pela fila do §6.2. Mudo corta a fala atual e descarta o que esperava.

export interface PlayerDeps {
  synth(item: SpeechItem): Promise<SynthResult>
  play(r: SynthResult): Promise<void>
  stop(): void
  muted(): boolean
  onNotice(text: string): void
}

export function createVoicePlayer(deps: PlayerDeps) {
  const queue = new VoiceQueue()
  let busy = false
  let generation = 0

  async function pump() {
    if (busy) return
    busy = true
    const gen = generation
    try {
      for (let item = queue.next(); item; item = queue.next()) {
        if (deps.muted() || gen !== generation) break
        try {
          const r = await deps.synth(item)
          if (r.notice) deps.onNotice(r.notice)
          if (deps.muted() || gen !== generation) break
          await deps.play(r)
        } catch { /* falha de voz nunca atrapalha o pedido */ }
      }
    } finally {
      busy = false
    }
  }

  return {
    enqueue(item: SpeechItem) {
      if (deps.muted()) return
      queue.push(item)
      void pump()
    },
    mute() {
      generation++
      queue.clear()
      deps.stop()
    },
  }
}

let current: HTMLAudioElement | undefined
let release: (() => void) | undefined

/** Toca o áudio e resolve quando termina (ou quando é parado). */
export function playAudio(r: SynthResult): Promise<void> {
  stopAudio()
  return new Promise(resolve => {
    const a = new Audio(`data:${r.mime};base64,${r.audio}`)
    current = a
    release = resolve
    a.onended = a.onerror = () => { if (current === a) current = undefined; resolve() }
    const started = a.play() as Promise<void> | undefined
    if (started) started.catch(() => resolve())
    else resolve()
  })
}

export function stopAudio(): void {
  current?.pause()
  current = undefined
  release?.()
  release = undefined
}
