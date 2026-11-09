import { create } from 'zustand'
import type { McpServerDef } from '@shared/mcp'

// MCPs instalados no Tutti e a janela de MCPs (spec mcps §2).

interface McpState {
  list: McpServerDef[]
  open: boolean
  load(): Promise<void>
  setOpen(open: boolean): void
}

export const useMcpStore = create<McpState>(set => ({
  list: [],
  open: false,
  async load() {
    set({ list: await window.time.mcps() })
  },
  setOpen(open) {
    set({ open })
  },
}))
