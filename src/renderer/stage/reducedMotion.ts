let query: MediaQueryList | undefined

/** Guarda a consulta: é lida a cada quadro por mascote, e criar uma nova a cada vez pesa. */
export function reducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false
  query ??= matchMedia('(prefers-reduced-motion: reduce)')
  return query.matches
}
