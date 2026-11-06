import { create } from 'zustand'

// Palco ou Escritório (design §7.1): a escolha é global e fica salva neste computador.
// O Navegador só existe enquanto há abas: não fica salvo, e sair dele volta à vista anterior.

export type StageView = 'palco' | 'escritorio' | 'navegador'
const KEY = 'tutti:stage-view'
const saved = (): 'palco' | 'escritorio' => { try { return localStorage.getItem(KEY) === 'escritorio' ? 'escritorio' : 'palco' } catch { return 'palco' } }

export const useViewStore = create<{ view: StageView; setView(v: StageView): void; leaveBrowser(): void }>(set => ({
  view: saved(),
  setView(view) {
    if (view !== 'navegador') { try { localStorage.setItem(KEY, view) } catch { /* sem armazenamento */ } }
    set({ view })
  },
  leaveBrowser() { set({ view: saved() }) },
}))
