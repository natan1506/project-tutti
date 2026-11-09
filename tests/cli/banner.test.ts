import { describe, expect, it } from 'vitest'
import { bannerLines } from '../../src/cli/banner'

describe('tela de entrada', () => {
  const lines = bannerLines({ version: '0.7.0', project: 'calculadora', team: [
    { nome: 'Bússola', tool: 'Claude', papel: 'cérebro' }, { nome: 'Forja', tool: 'Codex', papel: 'executor' },
  ] })
  const text = lines.map(l => l.text).join('\n')
  it('moldura arredondada com o ícone em pixels e o Tutti em gradiente do app', () => {
    expect(lines[0].text.startsWith('╭')).toBe(true)
    const box = lines.slice(0, lines.findIndex(l => l.text.startsWith('╰')) + 1)
    expect(box.at(-1)!.text.startsWith('╰')).toBe(true)
    const parts = box.flatMap(l => l.parts ?? [])
    expect(parts.some(p => p.text.includes('▀') && p.bg)).toBe(true)
    const colors = parts.map(p => p.color)
    for (const c of ['#8b6cf6', '#3fd8ee']) expect(colors).toContain(c)
    for (const l of box) expect(l.text).toBe((l.parts ?? []).map(p => p.text).join(''))
    const widths = new Set(box.map(l => [...l.text].length))
    expect(widths.size).toBe(1)
  })
  it('cabe em 80 colunas', () => {
    for (const l of lines) expect([...l.text].length).toBeLessThanOrEqual(80)
  })
  it('versão e projeto ao lado da logo', () => {
    expect(text).toContain('v0.7.0')
    expect(text).toContain('calculadora')
  })
  it('mostra quem faz cada papel e como começar', () => {
    expect(text).toContain('Bússola (Claude) cérebro')
    expect(text).toContain('Forja (Codex) executor')
    expect(text).toContain('/config')
  })
  it('sem esteira, diz como ligar', () => {
    const t = bannerLines({ version: '0.7.0', project: 'x', team: [] }).map(l => l.text).join('\n')
    expect(t).toContain('/config perfil Trabalho')
  })
})
