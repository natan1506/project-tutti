import type { Line } from './lines'

// Resposta da IA (markdown) em linhas do terminal: títulos, listas, negrito, código e espaço entre blocos.

type Part = NonNullable<Line['parts']>[number]

/** `**negrito**` e `` `código` `` viram pedaços com estilo; sem marcação, linha simples. */
function inline(s: string, base: Omit<Part, 'text'> = {}): Line {
  const bits = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean)
  if (bits.length === 1 && !/^(\*\*|`)/.test(bits[0]) && !Object.keys(base).length) return { text: s }
  const parts: Part[] = bits.map(b => (b.startsWith('**') && b.endsWith('**') && b.length > 4 ? { ...base, text: b.slice(2, -2), bold: true }
    : b.startsWith('`') && b.endsWith('`') && b.length > 2 ? { ...base, text: b.slice(1, -1), color: 'cyan' } : { ...base, text: b }))
  return { text: parts.map(p => p.text).join(''), parts, wrap: true }
}

export function mdLines(text: string, o: { dim?: boolean } = {}): Line[] {
  const rows = format(text)
  if (!o.dim) return rows
  // Fala do agente no meio do trabalho: a mesma formatação, toda em cinza.
  return rows.map(l => (l.parts ? { ...l, parts: l.parts.map(p => ({ ...p, color: 'gray' })) } : { ...l, color: 'gray' as const }))
}

function format(text: string): Line[] {
  const out: Line[] = []
  const blank = () => { if (out.length && out.at(-1)!.text !== '') out.push({ text: '' }) }
  let code = false
  for (const raw of text.split('\n')) {
    if (/^\s*```/.test(raw)) { code = !code; continue }
    if (code) { out.push({ text: `    ${raw}`, color: 'gray' }); continue }
    const line = raw.trimEnd()
    if (!line.trim()) { blank(); continue }
    if (/^\s*\|?[\s:|-]*-{2,}[\s:|-]*$/.test(line)) continue // separação de tabela
    const h = line.match(/^#{1,6}\s+(.*)$/)
    if (h) { blank(); out.push(inline(h[1].replace(/\*\*/g, ''), { bold: true, color: 'cyan' })); continue }
    const li = line.match(/^(\s*)[-*+]\s+(.*)$/)
    if (li) { const l = inline(li[2]); out.push(prefix(l, `${' '.repeat(li[1].length)}- `)); continue }
    const ol = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/)
    if (ol) { const l = inline(ol[3]); out.push(prefix(l, `${' '.repeat(ol[1].length)}${ol[2]}. `)); continue }
    const q = line.match(/^>\s?(.*)$/)
    if (q) { const l = inline(q[1], { italic: true }); out.push({ text: `│ ${l.text}`, wrap: true, parts: [{ text: '│ ', color: 'gray' }, ...(l.parts ?? [])] }); continue }
    out.push(inline(line))
  }
  while (out.at(-1)?.text === '') out.pop()
  return out
}

export function prefix(l: Line, p: string): Line {
  return l.parts ? { ...l, text: p + l.text, parts: [{ text: p }, ...l.parts] } : { ...l, text: p + l.text }
}
