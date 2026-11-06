// Prova com agente de verdade: o Forja abre uma página local, clica e responde o que viu. Gasta um pedido da assinatura do Claude Code.
// Uso: npm run build && node scripts/e2e/verify-navegador-agente.mjs <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const SHOTS = process.argv[2]
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const T = mkdtempSync(join(tmpdir(), 'tutti-nav-'))
execFileSync('git', ['init', '-q'], { cwd: T })
writeFileSync(join(T, 'README.md'), '# nav\n')
const HTML = `<!doctype html><title>Antes</title><h1>Loja de teste</h1>
<button onclick="document.getElementById('r').textContent='codigo-7421'">Mostrar código</button><p id="r"></p>`
const server = createServer((_q, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(HTML) })
await new Promise(r => server.listen(0, r))
const URL0 = `http://localhost:${server.address().port}/`

const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
const shot = async name => {
  if (!SHOTS) return
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}
let code = 1
try {
  await page.waitForTimeout(1500)
  await page.evaluate(p => window.time.openProject(p), T)
  await page.click('.proj')
  await page.click(`.menu button:has-text("${basename(T)}")`)
  await page.waitForTimeout(2500)
  await page.locator('.composer button:has-text("Forja")').first().click()
  await page.locator('.composer textarea').fill(`Abra ${URL0} no navegador do Tutti, clique no botão da página e me diga o código que aparecer. Só isso.`)
  await page.keyboard.press('Enter')
  const t0 = Date.now()
  let approvals = 0, opened = false
  while (Date.now() - t0 < 180_000) {
    if (!opened && await page.locator('.browser-panel:not(.empty)').count()) { opened = true; await page.waitForTimeout(800); await shot('agente-abriu') }
    const allow = page.locator('.pending-dock button:has-text("Aprovar"), .pending-dock button:has-text("Permitir")').first()
    if (await allow.count()) { approvals++; console.log('aprovação:', (await page.locator('.pending-dock').innerText()).replace(/\s+/g, ' ').slice(0, 120)); await shot('agente-aprovacao'); await allow.click() }
    const log = await page.locator('.log').innerText()
    if (/codigo-7421/.test(log)) { console.log('ok  o agente leu o código na página'); code = 0; break }
    await page.waitForTimeout(1000)
  }
  console.log(`abriu o painel: ${opened} · aprovações: ${approvals} · ${Math.round((Date.now() - t0) / 1000)} s`)
  await shot('agente-fim')
  console.log((await page.locator('.log').innerText()).slice(-700))
} catch (e) {
  console.log('erro:', e.message); await shot('agente-erro')
} finally {
  await app.close()
  server.close()
}
process.exit(code)
