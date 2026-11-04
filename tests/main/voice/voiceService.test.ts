import { describe, expect, it, vi } from 'vitest'
import { parseSayVoices, VoiceService, type VoiceDeps } from '../../../src/main/voice/voiceService'

const SAY = [
  'Albert              en_US    # Hello! My name is Albert.',
  'Eddy (Português (Brasil)) pt_BR    # Olá, meu nome é Eddy.',
  'Luciana             pt_BR    # Olá, meu nome é Luciana.',
  'Flo (Português (Brasil)) pt_BR    # Olá, meu nome é Flo.',
].join('\n')

function make(over: Partial<VoiceDeps> = {}) {
  const settings = new Map<string, unknown>()
  const deps: VoiceDeps = {
    store: {
      getSetting: <T>(k: string) => settings.get(k) as T | undefined,
      setSetting: (k: string, v: unknown) => { settings.set(k, v) },
      deleteSetting: (k: string) => { settings.delete(k) },
    },
    crypto: { isAvailable: () => true, encrypt: s => Buffer.from(`x${s}`), decrypt: b => b.toString().slice(1) },
    sayVoices: vi.fn(async () => SAY),
    sayToWav: vi.fn(async () => Buffer.from('WAV')),
    fetch: vi.fn(async () => new Response('nada', { status: 500 })) as unknown as typeof fetch,
    profileAgents: (id: string) => (['bussola', 'forja', 'pincel'].includes(id) ? ['bussola', 'forja', 'pincel'] : [id]),
    ...over,
  }
  return { svc: new VoiceService(deps), deps, settings }
}

describe('vozes do macOS', () => {
  it('lê a lista do say; só pt_BR, a não ser que peça todas', () => {
    expect(parseSayVoices(SAY).map(v => v.id)).toEqual(['Albert', 'Eddy', 'Luciana', 'Flo'])
    expect(parseSayVoices(SAY).find(v => v.id === 'Eddy')).toEqual({ id: 'Eddy', name: 'Eddy', lang: 'pt_BR' })
  })

  it('padrão automático: voz pt_BR distinta por agente dentro do perfil, na ordem', async () => {
    const { svc } = make()
    const vs = await Promise.all(['bussola', 'forja', 'pincel'].map(id => svc.choiceFor(id)))
    expect(vs.map(v => v.voiceId)).toEqual(['Luciana', 'Eddy', 'Flo'])
    expect(vs.every(v => v.source === 'macos')).toBe(true)
  })

  it('escolha salva vale por agente', async () => {
    const { svc } = make()
    svc.setChoice('forja', { source: 'macos', voiceId: 'Flo' })
    expect(await svc.choiceFor('forja')).toEqual({ source: 'macos', voiceId: 'Flo' })
  })

  it('sintetiza com say e devolve WAV em base64', async () => {
    const { svc, deps } = make()
    const r = await svc.synthesize('forja', 'Oi')
    expect(deps.sayToWav).toHaveBeenCalledWith('Oi', 'Eddy')
    expect(r).toEqual({ audio: Buffer.from('WAV').toString('base64'), mime: 'audio/wav' })
  })
})

describe('VoiceStudio', () => {
  it('fala pela API local com o modelo e o idioma', async () => {
    const fetch = vi.fn(async (url: string) => (url.endsWith('/v1/audio/speech') ? new Response(Buffer.from('MP3')) : new Response('{}')))
    const { svc } = make({ fetch: fetch as unknown as typeof globalThis.fetch })
    svc.setChoice('forja', { source: 'voicestudio', voiceId: 'ana' })
    const r = await svc.synthesize('forja', 'Oi')
    const [url, init] = fetch.mock.calls.find(c => String(c[0]).endsWith('/speech'))! as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:3900/v1/audio/speech')
    expect(JSON.parse(String(init.body))).toMatchObject({ input: 'Oi', voice: 'ana', language: 'pt', response_format: 'mp3' })
    expect(r.mime).toBe('audio/mpeg')
    expect(r.notice).toBeUndefined()
  })

  it('fechado: cai para o macOS e avisa uma vez por sessão', async () => {
    const fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    const { svc, deps } = make({ fetch: fetch as unknown as typeof globalThis.fetch })
    svc.setChoice('forja', { source: 'voicestudio', voiceId: 'ana' })
    const r1 = await svc.synthesize('forja', 'Oi', 'Forja')
    const r2 = await svc.synthesize('forja', 'Oi de novo', 'Forja')
    expect(deps.sayToWav).toHaveBeenLastCalledWith('Oi de novo', 'Eddy')
    expect(r1.notice).toBe('A voz do Forja (VoiceStudio) falhou; usei a do macOS.')
    expect(r2.notice).toBeUndefined()
  })

  it('lista as vozes e diz se está aberto', async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/health') ? new Response('{"ok":true}')
      : new Response(JSON.stringify({ voices: [{ id: 'ana', name: 'Ana' }] })))
    const { svc } = make({ fetch: fetch as unknown as typeof globalThis.fetch })
    expect(await svc.list('voicestudio')).toEqual([{ id: 'ana', name: 'Ana' }])
    expect((await svc.status()).voicestudio).toBe(true)
  })
})

describe('ElevenLabs', () => {
  const eleven = () => vi.fn(async (url: string, init?: RequestInit) => {
    const key = (init?.headers as Record<string, string> | undefined)?.['xi-api-key']
    if (key !== 'k-teste') return new Response('{}', { status: 401 })
    if (url.endsWith('/v1/voices')) return new Response(JSON.stringify({ voices: [{ voice_id: 'v1', name: 'Rachel', labels: { language: 'pt' } }] }))
    if (url.endsWith('/v1/user/subscription')) return new Response(JSON.stringify({ character_count: 1200, character_limit: 10000, next_character_count_reset_unix: 1800000000 }))
    if (url.includes('/v1/text-to-speech/v1')) return new Response(Buffer.from('MP3'))
    return new Response('{}', { status: 404 })
  })

  it('a chave fica cifrada; a interface só sabe se existe', async () => {
    const { svc, settings } = make({ fetch: eleven() as unknown as typeof fetch })
    expect((await svc.status()).elevenlabs.hasKey).toBe(false)
    svc.setKey('k-teste')
    expect(JSON.stringify([...settings.values()])).not.toContain('"k-teste"')
    const st = await svc.status()
    expect(st.elevenlabs).toEqual({ hasKey: true, credits: { used: 1200, limit: 10000, resetsAt: 1800000000000 } })
    svc.removeKey()
    expect((await svc.status()).elevenlabs.hasKey).toBe(false)
  })

  it('lista vozes e fala com o modelo multilíngue', async () => {
    const fetch = eleven()
    const { svc } = make({ fetch: fetch as unknown as typeof globalThis.fetch })
    svc.setKey('k-teste')
    expect(await svc.list('elevenlabs')).toEqual([{ id: 'v1', name: 'Rachel', lang: 'pt' }])
    svc.setChoice('forja', { source: 'elevenlabs', voiceId: 'v1' })
    const r = await svc.synthesize('forja', 'Oi')
    const call = fetch.mock.calls.find(c => String(c[0]).includes('text-to-speech'))! as unknown as [string, RequestInit]
    expect(JSON.parse(String(call[1].body))).toEqual({ text: 'Oi', model_id: 'eleven_multilingual_v2' })
    expect(r.mime).toBe('audio/mpeg')
  })

  it('sem chave: cai para o macOS', async () => {
    const { svc } = make({ fetch: eleven() as unknown as typeof fetch })
    svc.setChoice('forja', { source: 'elevenlabs', voiceId: 'v1' })
    const r = await svc.synthesize('forja', 'Oi', 'Forja')
    expect(r.mime).toBe('audio/wav')
    expect(r.notice).toBe('A voz do Forja (ElevenLabs) falhou; usei a do macOS.')
  })
})

describe('mudo', () => {
  it('guarda o mudo', () => {
    const { svc } = make()
    expect(svc.muted()).toBe(false)
    svc.setMuted(true)
    expect(svc.muted()).toBe(true)
  })
})
