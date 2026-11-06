import { session, WebContentsView, type BrowserWindow, type DownloadItem, type WebContents } from 'electron'
import type { BrowserBounds } from '@shared/browser'
import { axToText, type AxNode, type FieldInfo } from './browserPolicy'
import type { PageDriver, PageHooks } from './browserService'

// Página real: uma WebContentsView por agente, comandada pelo protocolo de depuração do próprio Chromium.
// Sessão separada (cookies só daqui), sem preload nem Node: o site não alcança nada do Tutti.

const PARTITION = 'persist:tutti-browser'
const pages = new Map<number, ElectronPage>()
let sessionReady = false

function prepareSession() {
  if (sessionReady) return
  sessionReady = true
  const s = session.fromPartition(PARTITION)
  // Site nenhum ganha câmera, microfone, localização ou notificações.
  s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  s.setPermissionCheckHandler(() => false)
  s.on('will-download', (e, item, wc) => { pages.get(wc.id)?.onDownload(e, item) })
}

const LOAD_LIMIT_MS = 30_000
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

export class ElectronPage implements PageDriver {
  private view: WebContentsView
  private wc: WebContents
  private refs = new Map<string, number>()
  private inputOn = false
  private allowDownload = new Set<string>()

  constructor(private win: BrowserWindow, private hooks: PageHooks) {
    prepareSession()
    this.view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    this.view.setBackgroundColor('#ffffff')
    // Sem tamanho a página não desenha nem monta a árvore: já nasce com um, escondida até o painel dizer onde fica.
    this.view.setBounds({ x: 0, y: 0, width: 1100, height: 700 })
    this.view.setVisible(false)
    win.contentView.addChildView(this.view)
    this.wc = this.view.webContents
    pages.set(this.wc.id, this)
    this.wc.setWindowOpenHandler(({ url }) => {
      if (hooks.onNavigate(url)) void this.wc.loadURL(url).catch(() => {})
      return { action: 'deny' }
    })
    this.wc.on('will-navigate', e => { if (!hooks.onNavigate(e.url)) e.preventDefault() })
    this.wc.on('will-redirect', e => { if (e.isMainFrame && !hooks.onNavigate(e.url)) e.preventDefault() })
    for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page'] as const) {
      this.wc.on(ev as 'did-start-loading', () => hooks.onChange())
    }
    this.wc.debugger.attach('1.3')
    // alert/confirm travariam a página: fecha na hora.
    this.wc.debugger.on('message', (_e, method) => {
      if (method === 'Page.javascriptDialogOpening') void this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {})
    })
    void Promise.all(['Page.enable', 'DOM.enable', 'Accessibility.enable'].map(m => this.send(m)))
      .then(() => this.send('Emulation.setFocusEmulationEnabled', { enabled: true }))
      .then(() => this.syncInput())
      .catch(() => {})
  }

  get url() { return this.wc.isDestroyed() ? 'about:blank' : this.wc.getURL() || 'about:blank' }
  get title() { return this.wc.isDestroyed() ? '' : this.wc.getTitle() }
  get loading() { return !this.wc.isDestroyed() && this.wc.isLoading() }

  private send<T = unknown>(method: string, params?: object): Promise<T> {
    return this.wc.debugger.sendCommand(method, params) as Promise<T>
  }

  private syncInput() { return this.send('Input.setIgnoreInputEvents', { ignore: !this.inputOn }) }

  /** A entrada fica desligada enquanto o agente manda; abre só durante a ação dele. */
  private async withInput<T>(fn: () => Promise<T>): Promise<T> {
    await this.send('Input.setIgnoreInputEvents', { ignore: false })
    try { return await fn() } finally { await this.syncInput().catch(() => {}) }
  }

  private node(ref: string): number {
    const id = this.refs.get(ref)
    if (id === undefined) throw new Error(`a referência ${ref} não existe mais; use ler_pagina de novo`)
    return id
  }

  async load(url: string) {
    if (!this.hooks.onNavigate(url)) throw new Error(`o endereço ${url} foi barrado`)
    this.refs.clear()
    await Promise.race([this.wc.loadURL(url), delay(LOAD_LIMIT_MS)])
  }

  async snapshot() {
    const { nodes } = await this.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree')
    const { text, refs } = axToText(nodes)
    this.refs = refs
    return text
  }

  async screenshot() {
    const shot = this.send<{ data: string }>('Page.captureScreenshot', { format: 'jpeg', quality: 60 })
    const r = await Promise.race([shot, delay(10_000).then(() => null)])
    if (!r) throw new Error('o print demorou demais')
    return r.data
  }

  async describe(ref: string): Promise<FieldInfo> {
    const backendNodeId = this.node(ref)
    const { node } = await this.send<{ node: { attributes?: string[] } }>('DOM.describeNode', { backendNodeId })
    const a = node.attributes ?? [], attr: Record<string, string> = {}
    for (let i = 0; i + 1 < a.length; i += 2) attr[a[i].toLowerCase()] = a[i + 1]
    const { nodes } = await this.send<{ nodes: AxNode[] }>('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false })
    return {
      role: String(nodes[0]?.role?.value ?? ''), label: String(nodes[0]?.name?.value ?? '') || attr['aria-label'],
      name: attr.name, id: attr.id, type: attr.type, autocomplete: attr.autocomplete, placeholder: attr.placeholder,
    }
  }

  async click(ref: string) {
    const backendNodeId = this.node(ref)
    await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId })
    const { quads } = await this.send<{ quads: number[][] }>('DOM.getContentQuads', { backendNodeId })
    const q = quads[0]
    if (!q) throw new Error(`o elemento ${ref} não está visível`)
    const x = (q[0] + q[2] + q[4] + q[6]) / 4, y = (q[1] + q[3] + q[5] + q[7]) / 4
    await this.withInput(async () => {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    })
  }

  async type(ref: string, text: string, submit: boolean) {
    const backendNodeId = this.node(ref)
    await this.send('DOM.focus', { backendNodeId })
    const { object } = await this.send<{ object: { objectId: string } }>('DOM.resolveNode', { backendNodeId })
    await this.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: "function(){if('value' in this){this.value='';this.dispatchEvent(new Event('input',{bubbles:true}))}else if(this.isContentEditable){this.textContent=''}}",
    })
    await this.withInput(async () => {
      await this.send('Input.insertText', { text })
      if (submit) {
        const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r' })
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
      }
    })
  }

  async scroll(direction: 'cima' | 'baixo') {
    const { width, height } = this.view.getBounds()
    await this.withInput(() => this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: height / 2, deltaX: 0, deltaY: direction === 'baixo' ? 600 : -600 }))
    await delay(150)
  }

  async back() {
    if (this.wc.navigationHistory.canGoBack()) this.wc.navigationHistory.goBack()
  }

  async reload() { this.wc.reload() }

  async settle() {
    await delay(200)
    for (let waited = 0; this.loading && waited < 5000; waited += 100) await delay(100)
  }

  setInputEnabled(on: boolean) {
    this.inputOn = on
    void this.syncInput().catch(() => {})
    if (on && !this.wc.isDestroyed()) this.wc.focus()
  }

  show(bounds: BrowserBounds | null) {
    if (bounds) this.view.setBounds(bounds)
    this.view.setVisible(!!bounds)
  }

  /** Download nunca começa sozinho: cancela, pergunta, e só então baixa de novo (a janela de salvar é do macOS). */
  onDownload(e: { preventDefault(): void }, item: DownloadItem) {
    const url = item.getURL()
    if (this.allowDownload.delete(url)) return
    e.preventDefault()
    void this.hooks.onDownload(item.getFilename()).then(ok => {
      if (!ok || this.wc.isDestroyed()) return
      this.allowDownload.add(url)
      this.wc.downloadURL(url)
    })
  }

  close() {
    pages.delete(this.wc.id)
    try { this.wc.debugger.detach() } catch { /* já solto */ }
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(this.view)
    if (!this.wc.isDestroyed()) this.wc.close()
  }
}
