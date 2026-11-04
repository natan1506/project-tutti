import type { RunEvent } from './events'

// Vozes (design escritório-autonomia-vozes §6): o que é falado, como o texto é limpo e a fila de fala.

export type VoiceSource = 'macos' | 'voicestudio' | 'elevenlabs'
export const VOICE_SOURCES: readonly VoiceSource[] = ['macos', 'voicestudio', 'elevenlabs']
export const VOICE_SOURCE_LABEL: Record<VoiceSource, string> = { macos: 'macOS', voicestudio: 'VoiceStudio', elevenlabs: 'ElevenLabs' }
export interface VoiceChoice { source: VoiceSource; voiceId: string }
export interface VoiceOption { id: string; name: string; lang?: string }
export interface SpeechItem { agentId: string; text: string; kind: 'alert' | 'done' }
export interface VoiceSourceStatus { macos: boolean; voicestudio: boolean; elevenlabs: { hasKey: boolean; credits?: { used: number; limit: number; resetsAt?: number } } }
export interface SynthResult { audio: string; mime: string; notice?: string }

export const SPEECH_MAX = 200

/** Texto pronto para falar: sem código, markdown nem links; só a primeira frase, até `max` caracteres. */
export function cleanForSpeech(text: string, max = SPEECH_MAX, whole = false): string {
  // Começa com um título curto (`# Título`)? Fala o título e a frase seguinte.
  const startsWithHeading = /^\s*#{1,6}\s/.test(text)
  let t = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*(.+)$/gm, '$1.')
    .replace(/^\s*[-*>]\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/([.!?])\.+/g, '$1')
    .trim()
  const sentences = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(x => x.trim()) ?? []
  t = (whole ? sentences : startsWithHeading ? sentences.slice(0, 2) : sentences.slice(0, 1)).join(' ')
  if (t.length > max) t = `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
  return /^[\s.!?]*$/.test(t) ? '' : t
}

interface RunLike { agentId: string; text: string; team?: boolean; parentRunId?: string }
interface SpeechCtx { coordinatorId?: string; toolName(tool: string): string }

/** Tabela do §6.2: o evento vira fala, ou nada. */
export function speechFor(ev: RunEvent, run: RunLike, ctx: SpeechCtx): SpeechItem | undefined {
  const say = (text: string, kind: SpeechItem['kind'], agentId = run.agentId): SpeechItem | undefined => {
    const clean = cleanForSpeech(text, SPEECH_MAX, kind === 'alert')
    return clean ? { agentId, text: clean, kind } : undefined
  }
  switch (ev.type) {
    case 'approval_request': return say(`Preciso da sua aprovação: ${ev.summary}`, 'alert')
    case 'question': return say(`Tenho uma pergunta. ${ev.text}`, 'alert')
    case 'plan_request': return say('O plano está pronto. Pode aprovar?', 'alert', ctx.coordinatorId ?? run.agentId)
    case 'limit_warning': return say(`O ${ctx.toolName(ev.tool)} está em ${Math.round(ev.utilization)}% do limite.`, 'alert')
    case 'error': return say(`Deu erro: ${ev.message.split('\n')[0]}`, 'done')
    case 'run_finished':
      if (ev.status !== 'done' || run.parentRunId) return undefined
      return say(run.text, 'done')
    default: return undefined
  }
}

const MAX_WAITING = 3

/** Uma fala por vez; alertas na frente; acima de 3 esperando, saem os "terminei" mais antigos. */
export class VoiceQueue {
  private items: SpeechItem[] = []
  push(item: SpeechItem): void {
    if (item.kind === 'alert') {
      const firstDone = this.items.findIndex(i => i.kind === 'done')
      this.items.splice(firstDone < 0 ? this.items.length : firstDone, 0, item)
    } else this.items.push(item)
    while (this.items.length > MAX_WAITING) {
      const oldDone = this.items.findIndex(i => i.kind === 'done')
      if (oldDone < 0) break
      this.items.splice(oldDone, 1)
    }
  }
  next(): SpeechItem | undefined { return this.items.shift() }
  size(): number { return this.items.length }
  clear(): void { this.items = [] }
}
