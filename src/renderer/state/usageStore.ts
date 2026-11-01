import { create } from 'zustand'
import type { UsageSnapshot } from '@shared/usage'

export const useUsageStore = create<{ snapshot?: UsageSnapshot; setSnapshot(s: UsageSnapshot): void }>(set => ({
  setSnapshot: snapshot => set({ snapshot }),
}))
