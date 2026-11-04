import { create } from 'zustand'

// Palco ou Escritório (design §7.1): a escolha é global e fica salva neste computador.

export type StageView = 'palco' | 'escritorio'
const KEY = 'tutti:stage-view'
const initial = (): StageView => { try { return localStorage.getItem(KEY) === 'escritorio' ? 'escritorio' : 'palco' } catch { return 'palco' } }

export const useViewStore = create<{ view: StageView; setView(v: StageView): void }>(set => ({
  view: initial(),
  setView(view) { try { localStorage.setItem(KEY, view) } catch { /* sem armazenamento */ } set({ view }) },
}))
