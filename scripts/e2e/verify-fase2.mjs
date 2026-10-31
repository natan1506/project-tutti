// Verificação ponta a ponta da Fase 2 (plano, Task 5): palco 3D no app Electron real.
// Uso: node scripts/e2e/verify-fase2.mjs <pasta-de-teste> <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [T, SHOTS] = process.argv.slice(2)
const results = []
const log = (step, ok, detail) => { results.push({ step, ok, detail }); console.log(`${ok ? 'OK ' : 'FALHOU'} ${step}: ${detail}`) }
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })
const pose = (page, id) => page.getAttribute(`[data-agent="${id}"]`, 'data-pose')

const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))

await page.evaluate(p => window.time.openProject(p), T)
await page.click('.proj')
await page.click('.menu button:has-text("time-teste-fase1")')
await page.waitForTimeout(2000)

// Passo 1 — palco parado
const canvas = await page.locator('.stage-3d canvas').count()
const tags = await page.locator('[data-agent]').count()
const locked = [await pose(page, 'radar'), await pose(page, 'curinga')]
log('1 palco 3D', canvas === 1 && tags === 6 && locked.every(p => p === 'locked') && errors.length === 0,
  `canvas=${canvas} rótulos=${tags} radar/curinga=${locked} erros=${JSON.stringify(errors).slice(0, 200)}`)
await shot(page, 'palco-parado')

// Passo 2 — clicar no mascote escolhe o agente
await page.click('[data-agent="pincel"]')
const pincelOn = await page.locator('.chip.on:has-text("Pincel")').count()
await page.click('[data-agent="radar"]')
const stillPincel = await page.locator('.chip.on:has-text("Pincel")').count()
log('2 clique escolhe agente', pincelOn === 1 && stillPincel === 1, `pincel selecionado=${pincelOn} após clicar no radar continua=${stillPincel}`)

// Passo 3 — Forja passa por pensando/trabalhando, concluído e volta a disponível
await page.click('[data-agent="forja"]')
await page.click('button:has-text("Nova conversa")').catch(() => {})
await page.fill('.inp textarea', 'Crie src/div.js exportando div(a,b) (ESM) e rode npm test. Responda curto.')
await page.keyboard.press('Enter')
const seen = []
let shotWorking = false, shotDone = false, bubbleWhileWorking = ''
const t0 = Date.now()
while (Date.now() - t0 < 240_000) {
  const p = await pose(page, 'forja')
  if (seen.at(-1) !== p) seen.push(p)
  if (p === 'working' && !shotWorking) {
    bubbleWhileWorking = await page.locator('.bubble').first().textContent().catch(() => '')
    await shot(page, 'forja-trabalhando'); shotWorking = true
  }
  if (p === 'done' && !shotDone) { await shot(page, 'forja-concluido'); shotDone = true }
  if (shotDone && p === 'idle') break
  await page.waitForTimeout(100)
}
log('3 estados do Forja', seen.includes('done') && seen.at(-1) === 'idle' && (seen.includes('working') || seen.includes('thinking')),
  `sequência=${seen.join(' → ')} balão trabalhando="${bubbleWhileWorking}"`)

// Passo 4 — Pincel esperando aprovação
await page.click('[data-agent="pincel"]')
await page.fill('.inp textarea', 'Instale o pacote left-pad com npm. Se eu negar, apenas encerre dizendo que não instalou.')
await page.keyboard.press('Enter')
await page.waitForFunction(() => document.querySelector('[data-agent="pincel"]')?.getAttribute('data-pose') === 'waiting', null, { timeout: 240_000 })
const alert = await page.locator('.bubble.alert').first().textContent()
await shot(page, 'pincel-esperando')
await page.locator('.approval button:has-text("Negar")').last().click()
await page.waitForFunction(() => ['idle', 'done'].includes(document.querySelector('[data-agent="pincel"]')?.getAttribute('data-pose') ?? ''), null, { timeout: 240_000 })
log('4 esperando aprovação', /aprovação/.test(alert ?? ''), `balão="${alert}" depois=${await pose(page, 'pincel')}`)

// Passo 5 — janela estreita
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760))
await page.waitForTimeout(1200)
const geo = await page.evaluate(() => {
  const stage = document.querySelector('.stage-3d').getBoundingClientRect()
  const r = [...document.querySelectorAll('[data-agent]')].map(e => e.getBoundingClientRect())
  const inside = r.every(b => b.left >= stage.left - 1 && b.right <= stage.right + 1)
  const overlap = r.some((b, i) => i > 0 && b.left < r[i - 1].right - 1)
  const bubbleMax = parseInt(getComputedStyle(document.querySelector('.stage-3d')).getPropertyValue('--bubble-max'))
  const spacingPx = (r[1].left + r[1].width / 2) - (r[0].left + r[0].width / 2)
  return { stageW: Math.round(stage.width), inside, overlap, bubbleMax, spacingPx: Math.round(spacingPx), bubbleFits: bubbleMax <= spacingPx }
})
log('5 janela estreita', geo.inside && !geo.overlap && geo.bubbleFits, JSON.stringify(geo))
await shot(page, 'estreito')

// Passo 6 — fps com o palco parado
const fps = await page.evaluate(() => new Promise(res => {
  let n = 0; const start = performance.now()
  const tick = () => { n++; if (performance.now() - start < 3000) requestAnimationFrame(tick); else res(Math.round(n / 3)) }
  requestAnimationFrame(tick)
}))
log('6 fps', fps >= 50, `${fps} fps`)

await app.close()
writeFileSync(join(SHOTS, 'resultado.json'), JSON.stringify(results, null, 2))
process.exit(results.every(r => r.ok) ? 0 : 1)
