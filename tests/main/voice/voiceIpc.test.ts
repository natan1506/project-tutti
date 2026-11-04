import { describe, expect, it, vi } from 'vitest'
import { voiceHandlers } from '../../../src/main/voice/voiceIpc'
import type { VoiceService } from '../../../src/main/voice/voiceService'

const svc = { synthesize: vi.fn(async () => ({ audio: '', mime: 'audio/wav' })), setChoice: vi.fn(), list: vi.fn(async () => { throw new Error('x') }) } as unknown as VoiceService

describe('IPC das vozes', () => {
  const h = voiceHandlers(svc)
  it('recusa agente, fonte e texto inválidos', () => {
    expect(() => h.setVoice({ agentId: 'forja', choice: { source: 'outra', voiceId: 'a' } })).toThrow()
    expect(() => h.synthesize({ agentId: 'ninguem', text: 'oi' })).toThrow()
    expect(() => h.synthesize({ agentId: 'forja', text: 'x'.repeat(1000) })).toThrow()
    expect(() => h.setVoiceKey('curta')).toThrow()
  })
  it('lista que falha vira lista vazia', async () => {
    expect(await h.voiceList({ source: 'voicestudio' })).toEqual([])
  })
})
