import { VOICE_SOURCE_LABEL, type SynthResult, type VoiceChoice, type VoiceOption, type VoiceSource, type VoiceSourceStatus } from '@shared/voice'
import type { KeyCrypto } from '../keys/keyStore'

// Vozes (design §6): síntese no processo principal. macOS (`say`) é o padrão e a rede de segurança;
// VoiceStudio é local (localhost:3900); ElevenLabs usa a chave do Natan, cifrada pelo Keychain.

export interface VoiceDeps {
  store: { getSetting<T>(k: string): T | undefined; setSetting(k: string, v: unknown): void; deleteSetting(k: string): void }
  crypto: KeyCrypto
  /** Saída de `say -v ?`. */
  sayVoices(): Promise<string>
  /** Fala `text` com a voz do macOS e devolve o WAV. */
  sayToWav(text: string, voice: string): Promise<Buffer>
  fetch: typeof fetch
  /** Ids dos agentes do perfil que contém este agente, na ordem (para o padrão automático). */
  profileAgents(agentId: string): string[]
}

const STUDIO = 'http://localhost:3900'
const ELEVEN = 'https://api.elevenlabs.io'
const KEY = 'voicekey:elevenlabs'
const PT_ORDER = ['Luciana', 'Eddy', 'Flo', 'Reed', 'Rocko', 'Sandy', 'Shelley', 'Grandpa', 'Grandma']
const TIMEOUT = 20_000

export function parseSayVoices(out: string): VoiceOption[] {
  return out.split('\n').flatMap(line => {
    const m = /^(.+?)\s+([a-z]{2}_[A-Z]{2})\s+#/.exec(line)
    if (!m) return []
    const name = m[1].replace(/\s*\(.*\)\s*$/, '').trim()
    return [{ id: name, name, lang: m[2] }]
  })
}

export class VoiceService {
  private macCache?: VoiceOption[]
  private warned = new Set<string>()
  constructor(private deps: VoiceDeps) {}

  private macLoading?: Promise<VoiceOption[]>

  /** `say -v ?` leva alguns segundos: o app chama isto ao abrir, e as chamadas seguintes reaproveitam. */
  async macVoices(all = false): Promise<VoiceOption[]> {
    this.macLoading ??= this.deps.sayVoices().then(parseSayVoices)
    this.macCache ??= await this.macLoading
    return all ? this.macCache : this.macCache.filter(v => v.lang === 'pt_BR')
  }

  async list(source: VoiceSource, all = false): Promise<VoiceOption[]> {
    if (source === 'macos') return this.macVoices(all)
    if (source === 'voicestudio') {
      const data = await this.json(`${STUDIO}/v1/audio/voices`) as { voices?: unknown[]; data?: unknown[] } | unknown[]
      const raw = (Array.isArray(data) ? data : data.voices ?? data.data ?? []) as Record<string, string>[]
      return raw.map(v => ({ id: String(v.id ?? v.voice_id ?? v.name), name: String(v.name ?? v.id) }))
    }
    const key = this.key()
    if (!key) return []
    const data = await this.json(`${ELEVEN}/v1/voices`, { headers: { 'xi-api-key': key } }) as { voices: { voice_id: string; name: string; labels?: { language?: string } }[] }
    return data.voices.map(v => ({ id: v.voice_id, name: v.name, ...(v.labels?.language ? { lang: v.labels.language } : {}) }))
  }

  async status(): Promise<VoiceSourceStatus> {
    const studio = await this.json(`${STUDIO}/health`).then(() => true, () => false)
    const key = this.key()
    let credits: VoiceSourceStatus['elevenlabs']['credits']
    if (key) {
      try {
        const s = await this.json(`${ELEVEN}/v1/user/subscription`, { headers: { 'xi-api-key': key } }) as { character_count: number; character_limit: number; next_character_count_reset_unix?: number }
        credits = { used: s.character_count, limit: s.character_limit, ...(s.next_character_count_reset_unix ? { resetsAt: s.next_character_count_reset_unix * 1000 } : {}) }
      } catch { /* chave inválida ou rede: mostra sem créditos */ }
    }
    return { macos: true, voicestudio: studio, elevenlabs: { hasKey: !!key, ...(credits ? { credits } : {}) } }
  }

  async choiceFor(agentId: string): Promise<VoiceChoice> {
    return this.deps.store.getSetting<VoiceChoice>(`voice:${agentId}`) ?? { source: 'macos', voiceId: await this.defaultMac(agentId) }
  }

  setChoice(agentId: string, choice: VoiceChoice): void { this.deps.store.setSetting(`voice:${agentId}`, choice) }

  async synthesize(agentId: string, text: string, agentName = agentId): Promise<SynthResult> {
    const choice = await this.choiceFor(agentId)
    if (choice.source !== 'macos') {
      try {
        return { audio: (await this.remote(choice, text)).toString('base64'), mime: 'audio/mpeg' }
      } catch {
        const fallback = await this.mac(await this.defaultMac(agentId), text)
        const warn = `${agentId}:${choice.source}`
        if (this.warned.has(warn)) return fallback
        this.warned.add(warn)
        return { ...fallback, notice: `A voz do ${agentName} (${VOICE_SOURCE_LABEL[choice.source]}) falhou; usei a do macOS.` }
      }
    }
    return this.mac(choice.voiceId, text)
  }

  setKey(key: string): void {
    if (!this.deps.crypto.isAvailable()) throw new Error('KEYCHAIN_UNAVAILABLE')
    this.deps.store.setSetting(KEY, this.deps.crypto.encrypt(key).toString('base64'))
  }
  removeKey(): void { this.deps.store.deleteSetting(KEY) }
  muted(): boolean { return this.deps.store.getSetting<boolean>('voice:muted') ?? false }
  setMuted(m: boolean): void { this.deps.store.setSetting('voice:muted', m) }

  private key(): string | undefined {
    const b64 = this.deps.store.getSetting<string>(KEY)
    if (!b64) return undefined
    try { return this.deps.crypto.decrypt(Buffer.from(b64, 'base64')) } catch { return undefined }
  }

  private async defaultMac(agentId: string): Promise<string> {
    const installed = new Set((await this.macVoices()).map(v => v.id))
    const pool = PT_ORDER.filter(v => installed.has(v))
    if (!pool.length) return 'Samantha'
    const i = Math.max(0, this.deps.profileAgents(agentId).indexOf(agentId))
    return pool[i % pool.length]
  }

  private async mac(voice: string, text: string): Promise<SynthResult> {
    return { audio: (await this.deps.sayToWav(text, voice)).toString('base64'), mime: 'audio/wav' }
  }

  private async remote(choice: VoiceChoice, text: string): Promise<Buffer> {
    if (choice.source === 'voicestudio') {
      return this.bytes(`${STUDIO}/v1/audio/speech`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'omnivoice', input: text, voice: choice.voiceId, response_format: 'mp3', language: 'pt' }),
      })
    }
    const key = this.key()
    if (!key) throw new Error('NO_KEY')
    return this.bytes(`${ELEVEN}/v1/text-to-speech/${encodeURIComponent(choice.voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
    })
  }

  private async res(url: string, init?: RequestInit): Promise<Response> {
    const r = await this.deps.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) })
    if (!r.ok) throw new Error(`HTTP_${r.status}`)
    return r
  }
  private async json(url: string, init?: RequestInit): Promise<unknown> { return (await this.res(url, init)).json() }
  private async bytes(url: string, init?: RequestInit): Promise<Buffer> { return Buffer.from(await (await this.res(url, init)).arrayBuffer()) }
}
