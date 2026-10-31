// Fase 3B, passo 5 isolado: cancelar um pedido de time com dois filhos rodando.
import { _electron as electron } from 'playwright'
import { join } from 'node:path'

const [T, SHOTS] = process.argv.slice(2)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.evaluate(p => window.time.openProject(p), T)
await page.click('.proj')
await page.click('.menu button:has-text("time-teste-fase1")')
await page.waitForTimeout(3000)
await page.click('button:has-text("Nova conversa")').catch(() => {})
await page.click('.chip:has-text("Time")')
await page.fill('.inp textarea', 'Crie server/sum.js exportando sum(a,b) com testes em server/sum.test.js, e crie web/sum.html com um formulário que some dois números. Responda curto.')
await page.keyboard.press('Enter')
const t0 = Date.now()
let children = 0
while (Date.now() - t0 < 300_000) {
  children = await page.locator('.children .step:has-text("trabalhando")').count()
  if (children >= 2) break
  const ok = page.locator('.approval:not(.answered):not(.plan) button:has-text("Permitir")').first()
  if (await ok.count()) await ok.click().catch(() => {})
  await sleep(200)
}
await page.screenshot({ path: join(SHOTS, 'antes-de-cancelar.png') })
await page.locator('button.link:has-text("Cancelar pedido")').last().click()
let stopped = false
for (let i = 0; i < 300 && !stopped; i++) { await sleep(200); stopped = (await page.locator('button.link:has-text("Cancelar pedido")').count()) === 0 }
const childSteps = await page.locator('.children .step').allTextContents()
await page.screenshot({ path: join(SHOTS, 'cancelado.png') })
console.log(`${children >= 2 && stopped && childSteps.every(s => !s.includes('trabalhando')) ? 'OK ' : 'FALHOU'} 5 cancelar com dois filhos: filhos rodando antes=${children} parou=${stopped} filhos depois=${JSON.stringify(childSteps)}`)
await app.close()
