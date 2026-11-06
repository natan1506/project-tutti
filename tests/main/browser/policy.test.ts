import { describe, expect, it } from 'vitest'
import { axToText, browserToolEvent, decideBrowser, hostApproved, isSensitiveField, siteOf, urlAllowed } from '../../../src/main/browser/browserPolicy'

describe('endereços', () => {
  it('só aceita páginas http e https, sem senha embutida', () => {
    for (const u of ['https://github.com/x', 'http://localhost:3000']) expect(urlAllowed(u)).toBe(true)
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'vscode://x', 'https://a:b@github.com', 'nada']) expect(urlAllowed(u)).toBe(false)
  })
  it('site aprovado vale para subdomínios, mas não para domínio parecido', () => {
    expect(siteOf('https://www.github.com/a')).toBe('github.com')
    expect(hostApproved('gist.github.com', new Set(['github.com']))).toBe(true)
    expect(hostApproved('github.com', new Set(['github.com']))).toBe(true)
    expect(hostApproved('evilgithub.com', new Set(['github.com']))).toBe(false)
    expect(hostApproved('github.com.evil.io', new Set(['github.com']))).toBe(false)
  })
})

describe('tabela de permissões aprovada', () => {
  const on = { approved: true }, off = { approved: false }
  it('ler é sempre livre', () => {
    for (const level of ['ask_all', 'accept_edits', 'autonomous'] as const) expect(decideBrowser('read', level, off)).toBe('allow')
  })
  it('site novo pede, menos no Sozinho; site já aprovado não pede de novo', () => {
    expect(decideBrowser('open', 'ask_all', off)).toBe('ask')
    expect(decideBrowser('open', 'accept_edits', off)).toBe('ask')
    expect(decideBrowser('open', 'autonomous', off)).toBe('allow')
    expect(decideBrowser('open', 'accept_edits', on)).toBe('allow')
    expect(decideBrowser('open', 'ask_all', on)).toBe('allow')
  })
  it('clicar e digitar: Perguntar tudo pede sempre; Aceitar edições só fora dos sites aprovados', () => {
    expect(decideBrowser('act', 'ask_all', on)).toBe('ask')
    expect(decideBrowser('act', 'accept_edits', on)).toBe('allow')
    expect(decideBrowser('act', 'accept_edits', off)).toBe('ask')
    expect(decideBrowser('act', 'autonomous', off)).toBe('allow')
  })
})

describe('campos sensíveis', () => {
  it('reconhece senha, cartão e código de uso único', () => {
    for (const f of [{ type: 'password' }, { autocomplete: 'cc-number' }, { autocomplete: 'current-password' }, { autocomplete: 'one-time-code' },
      { name: 'cvv' }, { id: 'card_number' }, { placeholder: 'Sua senha' }, { label: 'Número do cartão' }, { name: 'cpf' }]) {
      expect(isSensitiveField(f)).toBe(true)
    }
  })
  it('deixa passar campo comum', () => {
    for (const f of [{ type: 'text', name: 'q' }, { type: 'email', name: 'email' }, { label: 'Buscar', type: 'search' }, {}]) expect(isSensitiveField(f)).toBe(false)
  })
})

describe('leitura da página', () => {
  const nodes = [
    { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Título' }, childIds: ['2', '3', '4', '5'] },
    { nodeId: '2', parentId: '1', role: { value: 'heading' }, name: { value: 'Olá' }, childIds: [] },
    { nodeId: '3', parentId: '1', role: { value: 'button' }, name: { value: 'Entrar' }, backendDOMNodeId: 30, childIds: [] },
    { nodeId: '4', parentId: '1', role: { value: 'textbox' }, name: { value: 'Busca' }, value: { value: 'abc' }, backendDOMNodeId: 40, childIds: [] },
    { nodeId: '5', parentId: '1', ignored: true, role: { value: 'generic' }, childIds: ['6'] },
    { nodeId: '6', parentId: '5', role: { value: 'link' }, name: { value: 'Ajuda' }, backendDOMNodeId: 60, childIds: [] },
  ]
  it('dá referência só ao que é clicável ou editável', () => {
    const { text, refs } = axToText(nodes)
    expect(text).toContain('heading "Olá"')
    expect(text).toContain('[e1] button "Entrar"')
    expect(text).toContain('[e2] textbox "Busca" = "abc"')
    expect(text).toContain('[e3] link "Ajuda"')
    expect(refs.get('e1')).toBe(30)
    expect(refs.get('e3')).toBe(60)
    expect(refs.size).toBe(3)
  })
  it('corta página gigante avisando', () => {
    const many = [{ nodeId: '1', role: { value: 'RootWebArea' }, childIds: Array.from({ length: 5000 }, (_, i) => `n${i}`) },
      ...Array.from({ length: 5000 }, (_, i) => ({ nodeId: `n${i}`, parentId: '1', role: { value: 'paragraph' }, name: { value: 'x'.repeat(50) }, childIds: [] }))]
    const { text } = axToText(many, 2000)
    expect(text.length).toBeLessThan(2200)
    expect(text).toContain('cortada')
  })
})

describe('registro no chat', () => {
  it('nunca mostra o texto digitado', () => {
    const ev = browserToolEvent('mcp__navegador__digitar', { ref: 'e3', texto: 'segredo' })
    expect(ev?.name).toBe('Navegador')
    expect(ev?.summary).not.toContain('segredo')
  })
  it('mostra o endereço aberto e ignora outras ferramentas', () => {
    expect(browserToolEvent('mcp__navegador__abrir_pagina', { url: 'https://x.dev' })?.summary).toContain('https://x.dev')
    expect(browserToolEvent('Bash', {})).toBeUndefined()
  })
})
