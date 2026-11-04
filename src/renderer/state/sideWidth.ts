// Largura do painel do chat: o Natan arrasta a borda; vale para todas as janelas e fica salva neste computador.
export const SIDE_DEFAULT = 380
export const SIDE_MIN = 300
const KEY = 'tutti:side-width'

export function clampSideWidth(w: number, windowWidth: number): number {
  return Math.round(Math.min(Math.max(w, SIDE_MIN), Math.max(SIDE_MIN, windowWidth * 0.6)))
}

export function loadSideWidth(windowWidth: number): number {
  try {
    const n = Number(localStorage.getItem(KEY))
    return n > 0 ? clampSideWidth(n, windowWidth) : SIDE_DEFAULT
  } catch { return SIDE_DEFAULT }
}

export function saveSideWidth(w: number): void {
  try { localStorage.setItem(KEY, String(w)) } catch { /* sem armazenamento: só vale nesta sessão */ }
}

export function applySideWidth(w: number): void {
  document.documentElement.style.setProperty('--side-w', `${w}px`)
}
