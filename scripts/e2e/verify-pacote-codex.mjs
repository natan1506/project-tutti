// Pedido mínimo à Lupa (Codex) no Tutti instalado: prova que o binário do SDK do Codex roda de dentro do pacote.
// Uso: node scripts/e2e/verify-pacote-codex.mjs <pasta-de-teste> <print.png>
import { _electron as electron } from 'playwright'
const [T, SHOT] = process.argv.slice(2)
const app = await electron.launch({ executablePath: '/Applications/Tutti.app/Contents/MacOS/Tutti', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, USER: process.env.USER } })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.evaluate(p => window.time.openProject(p), T)
await page.click('.proj')
await page.click('.menu button:has-text("time-teste-fase1")')
await page.waitForTimeout(3000)
await page.click('button:has-text("Nova conversa")').catch(() => {})
const n = (await page.locator('.step').count()) + 1
await page.click('[data-agent="lupa"]')
await page.fill('.inp textarea', 'Responda apenas: ok. Não use ferramentas.')
await page.keyboard.press('Enter')
await page.waitForFunction(n => { const s = [...document.querySelectorAll('.step')]; return s.length >= n && !s[n - 1].textContent.includes('trabalhando') }, n, { timeout: 180_000 })
console.log('passo:', await page.locator('.step').nth(n - 1).textContent())
console.log('resposta:', await page.locator('.side .msg .tx').last().textContent())
await page.screenshot({ path: SHOT })
await app.close()
