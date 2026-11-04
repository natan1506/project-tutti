// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PADRAO } from '@shared/profiles'
import { MuteButton } from '../../src/renderer/components/MuteButton'
import { VoicesScreen } from '../../src/renderer/components/VoicesScreen'
import { createVoicePlayer } from '../../src/renderer/state/voicePlayer'
import { useProfileStore } from '../../src/renderer/state/profileStore'
import { useVoiceStore } from '../../src/renderer/state/voiceStore'

afterEach(cleanup)

const api = {
  voiceStatus: vi.fn(async (): Promise<import('@shared/voice').VoiceSourceStatus> => ({ macos: true, voicestudio: false, elevenlabs: { hasKey: false } })),
  voiceList: vi.fn(async ({ source }: { source: string }) => (source === 'macos' ? [{ id: 'Luciana', name: 'Luciana', lang: 'pt_BR' }, { id: 'Eddy', name: 'Eddy', lang: 'pt_BR' }] : [])),
  voiceChoice: vi.fn(async () => ({ source: 'macos', voiceId: 'Luciana' })),
  setVoice: vi.fn(async () => {}),
  synthesize: vi.fn(async () => ({ audio: 'QUJD', mime: 'audio/wav' })),
  setVoiceKey: vi.fn(async () => {}),
  removeVoiceKey: vi.fn(async () => {}),
  voiceMuted: vi.fn(async () => false),
  setVoiceMuted: vi.fn(async () => {}),
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, { time: api })
  useProfileStore.setState({ profiles: [PADRAO], active: PADRAO })
  useVoiceStore.setState({ muted: false, open: true, notice: undefined })
})

describe('tocador de voz', () => {
  it('toca um por vez, alertas primeiro; mudo corta e esvazia', async () => {
    const played: string[] = []
    let finish: (() => void) | undefined
    const stop = vi.fn()
    const p = createVoicePlayer({
      synth: async item => ({ audio: item.text, mime: 'audio/wav' }),
      play: async r => { played.push(r.audio); await new Promise<void>(res => { finish = res }) },
      stop,
      muted: () => useVoiceStore.getState().muted,
      onNotice: () => {},
    })
    p.enqueue({ agentId: 'forja', text: 'd1', kind: 'done' })
    p.enqueue({ agentId: 'forja', text: 'd2', kind: 'done' })
    p.enqueue({ agentId: 'forja', text: 'a1', kind: 'alert' })
    await act(async () => {})
    expect(played).toEqual(['d1'])
    await act(async () => { finish?.() })
    expect(played).toEqual(['d1', 'a1'])
    useVoiceStore.setState({ muted: true })
    p.mute()
    expect(stop).toHaveBeenCalled()
    await act(async () => { finish?.() })
    expect(played).toEqual(['d1', 'a1'])
    p.enqueue({ agentId: 'forja', text: 'd3', kind: 'done' })
    await act(async () => {})
    expect(played).toEqual(['d1', 'a1'])
  })
})

describe('botão de mudo', () => {
  it('alterna e grava', async () => {
    const r = render(<MuteButton />)
    await act(async () => {})
    fireEvent.click(r.getByRole('button', { name: 'Silenciar vozes' }))
    expect(api.setVoiceMuted).toHaveBeenCalledWith(true)
    expect(r.getByRole('button', { name: 'Ligar vozes' })).toBeTruthy()
  })
})

describe('tela de vozes', () => {
  it('mostra as fontes e uma linha por agente com a voz atual', async () => {
    const r = render(<VoicesScreen />)
    await act(async () => {})
    expect([...r.container.querySelectorAll('.voice-source b')].map(b => b.textContent)).toEqual(['macOS', 'VoiceStudio', 'ElevenLabs'])
    expect(r.getByText('Abra o VoiceStudio para usar estas vozes')).toBeTruthy()
    const rows = r.container.querySelectorAll('.voice-row')
    expect(rows.length).toBe(PADRAO.agents.length)
    const forja = within(rows[1] as HTMLElement)
    expect(forja.getByText('Forja')).toBeTruthy()
    expect((forja.getByLabelText('Voz do Forja') as HTMLSelectElement).value).toBe('Luciana')
  })

  it('trocar a voz grava; Ouvir fala a frase de apresentação', async () => {
    const r = render(<VoicesScreen />)
    await act(async () => {})
    const forja = within(r.container.querySelectorAll('.voice-row')[1] as HTMLElement)
    await act(async () => { fireEvent.change(forja.getByLabelText('Voz do Forja'), { target: { value: 'Eddy' } }) })
    expect(api.setVoice).toHaveBeenCalledWith({ agentId: 'forja', choice: { source: 'macos', voiceId: 'Eddy' } })
    await act(async () => { fireEvent.click(forja.getByText('▶ Ouvir')) })
    expect(api.synthesize).toHaveBeenCalledWith({ agentId: 'forja', text: expect.stringMatching(/^Oi, eu sou o Forja\./), name: 'Forja' })
  })

  it('escolher ElevenLabs pede confirmação de que o texto vai para a nuvem', async () => {
    api.voiceStatus.mockResolvedValueOnce({ macos: true, voicestudio: false, elevenlabs: { hasKey: true, credits: { used: 1000, limit: 10000 } } })
    const r = render(<VoicesScreen />)
    await act(async () => {})
    expect(r.getByText(/9\.000 de 10\.000 créditos/)).toBeTruthy()
    const forja = within(r.container.querySelectorAll('.voice-row')[1] as HTMLElement)
    await act(async () => { fireEvent.change(forja.getByLabelText('Fonte do Forja'), { target: { value: 'elevenlabs' } }) })
    expect(r.getByText(/o texto falado vai para a ElevenLabs/)).toBeTruthy()
    expect(api.setVoice).not.toHaveBeenCalled()
  })
})
