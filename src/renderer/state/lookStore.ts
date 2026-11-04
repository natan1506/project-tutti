import { create } from 'zustand'
import type { Look } from '@shared/look'

// Aparência escolhida por agente e a janela de Mascotes.

interface LookState {
  looks: Record<string, Look>
  open: boolean
  load(): Promise<void>
  set(agentId: string, look: Look | null): Promise<void>
  setOpen(open: boolean): void
}

export const useLookStore = create<LookState>(set => ({
  looks: {},
  open: false,
  async load() { set({ looks: await window.time.looks() }) },
  async set(agentId, look) { set({ looks: await window.time.setLook({ agentId, look }) }) },
  setOpen(open) { set({ open }) },
}))
