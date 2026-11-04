// Verificação do escritório 3D no app real: alterna Palco/Escritório, mascotes nas mesas, telefone tocando
// num pedido que pede aprovação (usa o Forja de verdade com um comando destrutivo, que é negado).
// Uso: npm run build && node scripts/e2e/verify-escritorio.mjs <pasta-de-prints> [--sem-agente]
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const [SHOTS, flag] = process.argv.slice(2)
mkdirSync(SHOTS, { recursive: true })
const results = []
const log = (step, ok, detail) => { results.push({ step, ok, detail }); console.log(`${ok ? 'OK ' : 'FALHOU'} ${step}: ${detail}`) }
const T = mkdtempSync(join(tmpdir(), 'tutti-escritorio-e2e-'))
execFileSync('git', ['init', '-q'], { cwd: T })
writeFileSync(join(T, 'a.txt'), 'x\n')

const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
try {
  await page.evaluate(p => window.time.openProject(p), T)
  await page.click('.proj')
  await page.click(`.menu button:has-text("${basename(T)}")`)
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.time.voiceMuted().then(m => m || window.time.setVoiceMuted(true)))
  await page.click('.view-toggle button:has-text("Escritório")')
  await page.waitForSelector('.office canvas')
  await page.waitForTimeout(2500)
  const tags = await page.locator('.office-tag').count()
  log('1 escritório abre com os agentes', tags >= 6, `etiquetas=${tags}`)
  await page.screenshot({ path: join(SHOTS, 'escritorio.png') })

  if (flag !== '--sem-agente') {
    await page.click('.chip:has-text("Forja")')
    await page.fill('.inp textarea', 'Rode exatamente `rm -f a.txt` e me diga o resultado.')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.approval:not(.answered)', { timeout: 180_000 })
    await page.waitForTimeout(1500)
    const pose = await page.locator('.office-tag [data-agent="forja"]').getAttribute('data-pose')
    log('2 Forja esperando no escritório', pose === 'waiting', `pose=${pose}`)
    await page.screenshot({ path: join(SHOTS, 'escritorio-telefone.png') })
    await page.click('.approval:not(.answered) button:has-text("Negar")')
    for (let i = 0; i < 120 && (await page.evaluate(() => window.time.activity())) > 0; i++) await page.waitForTimeout(500)
  }
  await page.click('.view-toggle button:has-text("Palco")')
  await page.waitForTimeout(800)
  log('3 volta ao palco', await page.locator('.stage-3d:not(.office)').count() === 1, 'palco visível')
  log('4 sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | ') || 'nenhum')
} catch (e) {
  log('execução', false, e.message)
  await page.screenshot({ path: join(SHOTS, 'erro.png') }).catch(() => {})
} finally {
  await page.evaluate(() => window.time.setVoiceMuted(false)).catch(() => {})
  await app.close()
}
process.exit(results.every(r => r.ok) ? 0 : 1)
