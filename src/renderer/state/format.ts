/** Tokens em formato curto, em português: 950 · 12,3 mil · 1,2 mi. */
export function formatTokens(n: number): string {
  const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  if (n >= 1_000_000) return `${fmt(n / 1_000_000)} mi`
  if (n >= 1_000) return `${fmt(n / 1_000)} mil`
  return String(n)
}
