import { create } from 'zustand'
import { EMPTY_BROWSER, type BrowserState } from '@shared/browser'
import { useViewStore } from './viewStore'

export const useBrowserStore = create<BrowserState>(() => EMPTY_BROWSER)

/** Estado novo do navegador: agente abriu aba ou chamou você → mostra; última aba fechada → volta à vista anterior. */
export function applyBrowserState({ opened, ...state }: BrowserState) {
  const hadTabs = useBrowserStore.getState().tabs.length > 0
  useBrowserStore.setState(state)
  const view = useViewStore.getState()
  if (opened) view.setView('navegador')
  else if (hadTabs && !state.tabs.length && view.view === 'navegador') view.leaveBrowser()
}
