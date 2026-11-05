/** Reconsulta os CLIs na hora, a cada `intervalMs` e quando a janela volta ao foco (ex.: Natan acabou de instalar um). */
export function startToolRefresh(load: () => Promise<void>, intervalMs = 5 * 60_000): () => void {
  const run = () => { void load() }
  run()
  const timer = setInterval(run, intervalMs)
  window.addEventListener('focus', run)
  return () => {
    clearInterval(timer)
    window.removeEventListener('focus', run)
  }
}
