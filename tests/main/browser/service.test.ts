import { describe, expect, it, vi } from 'vitest'
import { BrowserService, type PageDriver, type PageHooks } from '../../../src/main/browser/browserService'

function fakePage(hooks: PageHooks, fields: Record<string, object> = {}) {
  const p = {
    url: 'about:blank', title: '', loading: false, input: false, closed: false, clicks: [] as string[], typed: [] as string[], shownAt: null as unknown,
    async load(u: string) { if (hooks.onNavigate(u)) p.url = u },
    async snapshot() { return 'árvore' },
    async screenshot() { return 'b64' },
    async describe(ref: string) { return fields[ref] ?? { role: 'button', name: ref } },
    async click(ref: string) { p.clicks.push(ref) },
    async type(ref: string, t: string) { p.typed.push(`${ref}:${t}`) },
    async scroll() {}, async back() {}, async reload() {}, async settle() {},
    setInputEnabled(on: boolean) { p.input = on },
    show(b: unknown) { p.shownAt = b },
    close() { p.closed = true },
  }
  return p as typeof p & PageDriver
}

function setup(fields?: Record<string, object>) {
  const pages: ReturnType<typeof fakePage>[] = []
  const hooks: PageHooks[] = []
  const emit = vi.fn()
  let now = 1000
  const svc = new BrowserService({ createPage: h => { hooks.push(h); const p = fakePage(h, fields); pages.push(p); return p }, emit, now: () => now })
  const approve = vi.fn(async () => true)
  const ctx = (level: 'ask_all' | 'accept_edits' | 'autonomous' = 'accept_edits', over = {}) => ({ autonomy: () => level, requestApproval: approve, signal: new AbortController().signal, ...over })
  return { svc, pages, hooks, emit, approve, ctx, tick: (n: number) => { now += n } }
}

describe('abrir página', () => {
  it('site novo pede aprovação uma vez e abre a aba avisando a interface', async () => {
    const { svc, pages, approve, ctx, emit } = setup()
    await svc.open('forja', 'https://site.dev/a', ctx())
    await svc.open('forja', 'https://site.dev/b', ctx())
    expect(approve).toHaveBeenCalledTimes(1)
    expect(approve.mock.calls[0]).toEqual([expect.objectContaining({ toolName: 'Navegador', reason: 'network' })])
    expect(pages[0].url).toBe('https://site.dev/b')
    expect(emit.mock.calls.some(c => c[0].opened === 'forja')).toBe(true)
  })
  it('negado: não abre e avisa o agente', async () => {
    const { svc, pages, ctx } = setup()
    const r = await svc.open('forja', 'https://site.dev', ctx('accept_edits', { requestApproval: async () => false }))
    expect(r).toMatch(/negou/i)
    expect(pages[0]?.url ?? 'about:blank').toBe('about:blank')
  })
  it('recusa endereço que não é página', async () => {
    const { svc, ctx, approve } = setup()
    expect(await svc.open('forja', 'file:///etc/passwd', ctx('autonomous'))).toMatch(/só abre/i)
    expect(approve).not.toHaveBeenCalled()
  })
  it('no Sozinho abre sem perguntar', async () => {
    const { svc, ctx, approve, pages } = setup()
    await svc.open('forja', 'https://site.dev', ctx('autonomous'))
    expect(approve).not.toHaveBeenCalled()
    expect(pages[0].url).toBe('https://site.dev')
  })
})

describe('navegação iniciada pela página', () => {
  it('clique que levaria a site não aprovado é barrado e o agente fica sabendo', async () => {
    const { svc, hooks, ctx, pages } = setup()
    await svc.open('forja', 'https://site.dev', ctx())
    expect(hooks[0].onNavigate('https://site.dev/outra')).toBe(true)
    expect(hooks[0].onNavigate('https://golpe.io')).toBe(false)
    const r = await svc.click('forja', 'e1', ctx())
    expect(r).toContain('golpe.io')
    expect(pages[0].url).toBe('https://site.dev')
  })
  it('endereço estranho é barrado mesmo com você no controle', async () => {
    const { svc, hooks, ctx } = setup()
    await svc.open('forja', 'https://site.dev', ctx())
    svc.takeover('forja')
    expect(hooks[0].onNavigate('file:///etc/passwd')).toBe(false)
  })
  it('com você no controle, o site visitado passa a valer como aprovado', async () => {
    const { svc, hooks, ctx, approve } = setup()
    await svc.open('forja', 'https://site.dev', ctx('autonomous'))
    svc.takeover('forja')
    expect(hooks[0].onNavigate('https://login.io')).toBe(true)
    svc.release()
    approve.mockClear()
    await svc.open('forja', 'https://login.io', ctx())
    expect(approve).not.toHaveBeenCalled()
  })
})

describe('clicar e digitar', () => {
  it('Perguntar tudo pede a cada ação, citando o elemento', async () => {
    const { svc, ctx, approve, pages } = setup()
    await svc.open('forja', 'https://site.dev', ctx('autonomous'))
    await svc.click('forja', 'e1', ctx('ask_all'))
    expect(approve.mock.calls.at(-1)).toEqual([expect.objectContaining({ reason: 'ask_all', summary: expect.stringContaining('e1') })])
    expect(pages[0].clicks).toEqual(['e1'])
  })
  it('nunca digita em campo de senha, em nenhum nível', async () => {
    const { svc, ctx, pages } = setup({ e2: { role: 'textbox', type: 'password' } })
    await svc.open('forja', 'https://site.dev', ctx('autonomous'))
    const r = await svc.type('forja', 'e2', '123', false, ctx('autonomous'))
    expect(pages[0].typed).toEqual([])
    expect(r).toMatch(/chamar_usuario/)
  })
  it('sem página aberta, responde sem quebrar', async () => {
    const { svc, ctx } = setup()
    expect(await svc.read('forja', ctx())).toMatch(/nenhuma página/i)
  })
})

describe('assumir e devolver', () => {
  it('liga a entrada do usuário e faz o agente esperar até devolver', async () => {
    const { svc, ctx, pages } = setup()
    await svc.open('forja', 'https://site.dev', ctx('autonomous'))
    svc.takeover('forja')
    expect(pages[0].input).toBe(true)
    let done = false
    const p = svc.click('forja', 'e1', ctx('autonomous')).then(() => { done = true })
    await new Promise(r => setTimeout(r, 5))
    expect(done).toBe(false)
    svc.release()
    await p
    expect(done).toBe(true)
    expect(pages[0].input).toBe(false)
    expect(pages[0].clicks).toEqual(['e1'])
  })
  it('agente cancelado para de esperar', async () => {
    const { svc, ctx } = setup()
    await svc.open('forja', 'https://site.dev', ctx('autonomous'))
    svc.takeover('forja')
    const ac = new AbortController()
    const p = svc.click('forja', 'e1', ctx('autonomous', { signal: ac.signal }))
    ac.abort()
    expect(await p).toMatch(/cancel/i)
  })
  it('assumir outra aba devolve a anterior', async () => {
    const { svc, ctx, pages } = setup()
    await svc.open('forja', 'https://a.dev', ctx('autonomous'))
    await svc.open('pincel', 'https://b.dev', ctx('autonomous'))
    svc.takeover('forja')
    svc.takeover('pincel')
    expect(pages[0].input).toBe(false)
    expect(pages[1].input).toBe(true)
    expect(svc.state().control).toBe('pincel')
  })
})

describe('abas', () => {
  it('só a aba ativa aparece na área do painel', async () => {
    const { svc, ctx, pages } = setup()
    const box = { x: 1, y: 2, width: 3, height: 4 }
    svc.setBounds(box)
    await svc.open('forja', 'https://a.dev', ctx('autonomous'))
    await svc.open('pincel', 'https://b.dev', ctx('autonomous'))
    expect(pages[1].shownAt).toEqual(box)
    expect(pages[0].shownAt).toBeNull()
    svc.select('forja')
    expect(pages[0].shownAt).toEqual(box)
    expect(pages[1].shownAt).toBeNull()
    svc.setBounds(null)
    expect(pages[0].shownAt).toBeNull()
  })
  it('fechar tudo solta quem estava esperando e fecha as páginas', async () => {
    const { svc, ctx, pages } = setup()
    await svc.open('forja', 'https://a.dev', ctx('autonomous'))
    svc.takeover('forja')
    const p = svc.read('forja', ctx('autonomous'))
    svc.closeAll()
    await p
    expect(pages[0].closed).toBe(true)
    expect(svc.state().tabs).toEqual([])
  })
  it('aba parada há muito tempo fecha, menos a que você controla', async () => {
    const { svc, ctx, pages, tick } = setup()
    await svc.open('forja', 'https://a.dev', ctx('autonomous'))
    await svc.open('pincel', 'https://b.dev', ctx('autonomous'))
    svc.takeover('pincel')
    tick(16 * 60_000)
    svc.sweep()
    expect(pages[0].closed).toBe(true)
    expect(pages[1].closed).toBe(false)
  })
})

describe('downloads', () => {
  it('sempre pedem, mesmo no Sozinho; com você no controle, a escolha é sua', async () => {
    const { svc, hooks, ctx, approve } = setup()
    await svc.open('forja', 'https://a.dev', ctx('autonomous'))
    expect(await hooks[0].onDownload('x.zip')).toBe(true)
    expect(approve).toHaveBeenCalledTimes(1)
    svc.takeover('forja')
    expect(await hooks[0].onDownload('y.zip')).toBe(true)
    expect(approve).toHaveBeenCalledTimes(1)
  })
})
