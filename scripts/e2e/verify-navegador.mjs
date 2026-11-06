// Testa o navegador dos agentes no app real, sem gastar pedido: fala direto com o serviço (TUTTI_E2E) e com uma página local.
// Uso: npm run build && node scripts/e2e/verify-navegador.mjs <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

const SHOTS = process.argv[2]
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const HTML = `<!doctype html><title>Teste</title><h1>Página de teste</h1>
<button id="b" onclick="document.title='clicou '+(++window.n)">Contar</button>
<input aria-label="Nome" id="nome" oninput="document.title='nome='+this.value">
<input aria-label="Senha" type="password" id="s">
<a href="http://127.0.0.1:PORT/fora">Sair do site</a><script>window.n=0</script>`
const server = createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(HTML.replace('PORT', server.address().port)) })
await new Promise(r => server.listen(0, r))
const URL0 = `http://localhost:${server.address().port}/`

const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, TUTTI_E2E: '1' } })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok ' : 'FALHOU'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) fails++ }
// Chamada ao serviço com um contexto de agente; `level` define a autonomia e toda aprovação é aceita e contada.
const call = (method, args, level = 'autonomous') => app.evaluate(async (_e, [method, args, level]) => {
  globalThis.__asked ??= []
  const ctx = { autonomy: () => level, requestApproval: async r => { globalThis.__asked.push(r.summary); return true }, signal: new AbortController().signal }
  return globalThis.__tuttiBrowser[method](...args, ctx)
}, [method, args, level])
const ui = (method, ...args) => app.evaluate((_e, [m, a]) => globalThis.__tuttiBrowser[m](...a), [method, args])
const site = fn => app.evaluate(async ({ webContents }, fn) => {
  const wc = webContents.getAllWebContents().find(w => /localhost|127\.0\.0\.1/.test(w.getURL()) && !w.getURL().includes(':5173'))
  return new Function('wc', `return (${fn})(wc)`)(wc)
}, fn.toString())
const title = () => site(wc => wc.getTitle())
const shot = async name => {
  if (!SHOTS) return
  // Print da tela de verdade: o capturePage da janela não enxerga a vista nativa da página.
  const b = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); return w.getBounds() })
  await page.waitForTimeout(500)
  execFileSync('screencapture', ['-x', '-R', `${b.x},${b.y},${b.width},${b.height}`, join(SHOTS, `${name}.png`)])
}
const realClick = () => site(async wc => {
  // Clique "de verdade", como o de uma pessoa: entra pela janela, não pelo comando do agente.
  const r = await wc.executeJavaScript("(()=>{const r=document.getElementById('b').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 })
  await new Promise(res => setTimeout(res, 300))
})
const ref = (text, label) => text.match(new RegExp(`\\[(e\\d+)\\] [a-z]+ "${label}"`))?.[1]

try {
  await page.waitForTimeout(1500)
  await call('open', ['forja', URL0], 'autonomous')
  await page.waitForTimeout(800)
  check('abrir página troca para a vista Navegador', await page.locator('.browser-panel').count() === 1)
  check('aba com o nome do agente', await page.locator('.browser-tab:has-text("Forja")').count() === 1)
  check('endereço aparece', (await page.locator('[aria-label="Endereço"]').inputValue()) === URL0)
  const slot = await page.locator('.browser-slot').boundingBox()
  const view = await app.evaluate(({ BrowserWindow }) => { const v = BrowserWindow.getAllWindows()[0].contentView.children.find(c => c.getVisible()); return v?.getBounds() })
  check('a página ocupa exatamente a área do painel', !!view && Math.abs(view.x - slot.x) <= 1 && Math.abs(view.y - slot.y) <= 1 && Math.abs(view.width - slot.width) <= 1 && Math.abs(view.height - slot.height) <= 1, JSON.stringify(view))
  await shot('01-assistindo')

  let text = await call('read', ['forja'])
  check('leitura marca o conteúdo como não confiável', text.includes('<conteudo_do_site>'))
  check('leitura traz os itens clicáveis', !!ref(text, 'Contar') && !!ref(text, 'Nome'), ref(text, 'Contar'))

  await call('click', ['forja', ref(text, 'Contar')])
  check('agente clica', (await title()) === 'clicou 1', await title())
  await call('type', ['forja', ref(text, 'Nome'), 'Ana', false])
  check('agente digita', (await title()) === 'nome=Ana', await title())
  const refused = await call('type', ['forja', ref(text, 'Senha'), '123', false])
  check('agente nunca digita em senha', refused.includes('chamar_usuario') && (await site(wc => wc.executeJavaScript("document.getElementById('s').value"))) === '')
  const img = await call('screenshot', ['forja'])
  check('print da página', !!img.image && img.image.length > 1000)

  await realClick()
  check('assistindo: seu clique não chega na página', (await site(wc => wc.executeJavaScript('window.n'))) === 1)

  await page.click('.browser-mode:has-text("Assumir")')
  await page.waitForTimeout(300)
  await realClick()
  check('no controle: seu clique funciona', (await site(wc => wc.executeJavaScript('window.n'))) === 2)
  check('endereço fica editável', !(await page.locator('[aria-label="Endereço"]').getAttribute('readonly')))
  await shot('02-no-controle')
  await app.evaluate(async (_e, ref) => {
    const ctx = { autonomy: () => 'autonomous', requestApproval: async () => true, signal: new AbortController().signal }
    globalThis.__pending = globalThis.__tuttiBrowser.click('forja', ref, ctx).then(() => { globalThis.__pendingDone = true })
  }, ref(text, 'Contar'))
  await page.waitForTimeout(400)
  check('agente espera enquanto você controla', !(await app.evaluate(() => globalThis.__pendingDone)))
  await page.click('.browser-mode:has-text("Devolver")')
  await app.evaluate(() => globalThis.__pending)
  check('devolver: o agente continua', (await site(wc => wc.executeJavaScript('window.n'))) === 3)
  await realClick()
  check('depois de devolver: seu clique volta a não chegar', (await site(wc => wc.executeJavaScript('window.n'))) === 3)

  // Vista escondida: o agente segue trabalhando.
  await page.click('.view-toggle button:has-text("Palco")')
  await page.waitForTimeout(500)
  text = await call('read', ['forja'])
  check('escondida: ainda lê', text.includes('Contar'))
  const hiddenShot = await call('screenshot', ['forja'])
  check('escondida: ainda tira print', !!hiddenShot.image, hiddenShot.text ?? '')
  await call('click', ['forja', ref(text, 'Contar')])
  check('escondida: ainda clica', (await site(wc => wc.executeJavaScript('window.n'))) === 4)
  await page.click('.view-toggle button:has-text("Navegador")')
  await page.waitForTimeout(400)

  // Menu aberto: a página nativa sai da frente.
  const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.some(v => v.getVisible()))
  check('página visível na vista', await visible())
  await page.click('.proj')
  await page.waitForTimeout(300)
  check('menu aberto esconde a página', !(await visible()))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('menu fechado mostra de novo', await visible())

  // Site não aprovado, em Aceitar edições: link barrado; `file:` nunca.
  await ui('closeAll')
  await page.waitForTimeout(300)
  await call('open', ['pincel', URL0], 'accept_edits')
  text = await call('read', ['pincel'], 'accept_edits')
  const asked = await app.evaluate(() => globalThis.__asked)
  check('Aceitar edições pede para abrir site novo', asked.some(s => s.includes('localhost')), asked.join(' | '))
  const r = await call('click', ['pincel', ref(text, 'Sair do site')], 'accept_edits')
  check('link para site não aprovado é barrado', r.includes('127.0.0.1') && r.includes('barrada'), r.slice(0, 80))
  check('continua no site aprovado', (await site(wc => wc.getURL())).includes('localhost'))
  const f = await call('open', ['pincel', 'file:///etc/passwd'])
  check('arquivo local é recusado', f.includes('só abre'))

  const m = await app.evaluate(({ app }) => app.getAppMetrics().map(p => ({ type: p.type, mem: p.memory.workingSetSize })))
  console.log('memória (MB):', m.map(p => `${p.type} ${(p.mem / 1024).toFixed(0)}`).join(' | '))
  await ui('closeAll')
  await page.waitForTimeout(500)
  check('sem abas, volta à vista anterior', await page.locator('.browser-panel').count() === 0)
} catch (e) {
  console.log('FALHOU com erro:', e.message); fails++
  await shot('erro')
} finally {
  console.log('erros no console:', errors.length ? errors.slice(0, 5).join(' | ') : 'nenhum')
  await app.close()
  server.close()
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo')
process.exit(fails ? 1 : 0)
