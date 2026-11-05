let cached: boolean | undefined

/** Só testa uma vez: cada teste abre um contexto WebGL, e o navegador derruba os antigos depois de 16. */
export function hasWebGL(): boolean {
  if (cached !== undefined) return cached
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') ?? c.getContext('webgl')
    cached = !!gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    cached = false
  }
  return cached
}
