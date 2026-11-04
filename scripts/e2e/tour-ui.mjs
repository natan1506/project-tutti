// Passeio pelas telas para revisão de UI/UX: só tira prints, não cria nada que fique salvo.
// Uso: npm run build && node scripts/e2e/tour-ui.mjs <pasta-de-prints> [largura] [altura]
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const [SHOTS, W = '1440', H = '900'] = process.argv.slice(2)
mkdirSync(SHOTS, { recursive: true })
const T = mkdtempSync(join(tmpdir(), 'tutti-tour-'))
execFileSync('git', ['init', '-q'], { cwd: T })
writeFileSync(join(T, 'README.md'), '# tour\n')

const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [Number(W), Number(H)])
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
const shot = async name => { await page.waitForTimeout(500); await page.screenshot({ path: join(SHOTS, `${W}-${name}.png`) }) }
const esc = () => page.keyboard.press('Escape')

try {
  await page.evaluate(p => window.time.openProject(p), T)
  await page.click('.proj')
  await shot('01-menu-projeto')
  await page.click(`.menu button:has-text("${basename(T)}")`)
  await page.waitForTimeout(2500)
  await shot('02-principal')
  await page.click('.prof')
  await shot('03-menu-perfil')
  await page.keyboard.press('Escape')
  await page.click('.rail [aria-label="Perfis"]')
  await page.waitForSelector('.modal.profiles')
  await shot('04-perfis')
  await page.click('.profiles-list .menu-action:has-text("Novo perfil")')
  await shot('05-novo-perfil')
  await page.click('.profile-edit button:has-text("Adicionar agente")')
  await shot('06-novo-perfil-agente')
  await page.locator('.agent-form').last().locator('[aria-label="Transporte"]').selectOption('api').catch(() => {})
  await shot('07-novo-perfil-api')
  await page.locator('.modal.profiles').evaluate(el => el.scrollTo(0, el.scrollHeight)).catch(() => {})
  await shot('08-novo-perfil-fim')
  await page.click('.modal.profiles button:has-text("Fechar")').catch(esc)
  await page.waitForTimeout(500)
  await page.click('.rail [aria-label="Skills"]')
  await shot('09-skills')
  await esc()
  await page.click('.modal button:has-text("Fechar")').catch(() => {})
  await page.click('.usage, .usage-panel').catch(() => {})
  await shot('10-uso')
  await esc()
  await page.click('button:has-text("Time")').catch(() => {})
  await shot('11-time')
} catch (e) {
  console.log('erro:', e.message)
  await shot('erro')
} finally {
  console.log('erros no console:', errors.length ? errors.slice(0, 5).join(' | ') : 'nenhum')
  await app.close()
}
