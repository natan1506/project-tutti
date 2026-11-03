import { create } from 'zustand'
import type { Skill } from '@shared/skills'

// Skills criadas no Tutti e a janela de Skills (plano skills, Design §8).

interface SkillState {
  skills: Skill[]
  open: boolean
  load(): Promise<void>
  setOpen(open: boolean): void
}

export const useSkillStore = create<SkillState>(set => ({
  skills: [],
  open: false,
  async load() {
    set({ skills: await window.time.skills() })
  },
  setOpen(open) {
    set({ open })
  },
}))
