import { create } from 'zustand'

// Mudo global, a janela de Vozes e o aviso de voz que falhou (design §6).

interface VoiceState {
  muted: boolean
  open: boolean
  notice?: string
  /** O Natan já confirmou nesta sessão que o texto vai para a ElevenLabs. */
  elevenAck: boolean
  setOpen(open: boolean): void
}

export const useVoiceStore = create<VoiceState>(set => ({
  muted: false,
  open: false,
  elevenAck: false,
  setOpen(open) { set({ open }) },
}))
