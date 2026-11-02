// Aviso de versão nova: consulta a última release no GitHub e devolve a página dela.
// Sem certificado de desenvolvedor não há atualização automática no macOS; o Natan baixa o .dmg da página.

export const REPO = 'natan1506/project-tutti'
const RELEASES = `https://github.com/${REPO}/releases/`

const parse = (v: string): number[] | null => {
  const m = v.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/)
  return m ? m.slice(1).map(Number) : null
}

export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/** `null` quando não há versão nova ou não deu para saber (repositório privado, offline, resposta estranha). */
export async function checkForUpdate(current: string, fetchFn: typeof fetch = fetch): Promise<{ version: string; url: string } | null> {
  try {
    const r = await fetchFn(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!r.ok) return null
    const j = (await r.json()) as { tag_name?: unknown; html_url?: unknown }
    if (typeof j.tag_name !== 'string' || typeof j.html_url !== 'string' || !j.html_url.startsWith(RELEASES)) return null
    return isNewer(j.tag_name, current) ? { version: j.tag_name.replace(/^v/, ''), url: j.html_url } : null
  } catch {
    return null
  }
}
