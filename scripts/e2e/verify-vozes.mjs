// Verificação das vozes no app real: tela Vozes, prévia com voz do macOS, mudo. Não usa ElevenLabs.
// Uso: npm run build && node scripts/e2e/verify-vozes.mjs <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const [SHOTS] = process.argv.slice(2)
mkdirSync(SHOTS, { recursive: true })
const results = []
const log = (step, ok, detail) => { results.push({ step, ok, detail }); console.log(`${ok ? 'OK ' : 'FALHOU'} ${step}: ${detail}`) }
const T = mkdtempSync(join(tmpdir(), 'tutti-vozes-e2e-'))
execFileSync('git', ['init', '-q'], { cwd: T })
writeFileSync(join(T, 'README.md'), '# vozes\n')

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
  await page.click('.prof')
  await page.click('.menu-action:has-text("Vozes")')
  await page.waitForSelector('.voice-row')
  await page.waitForSelector('[aria-label="Voz do Forja"]:not([disabled])', { timeout: 20_000 })
  const rows = await page.locator('.voice-row').count()
  const forjaVoice = await page.locator('[aria-label="Voz do Forja"]').inputValue()
  log('1 tela Vozes', rows >= 6 && forjaVoice !== '', `linhas=${rows} voz do Forja=${forjaVoice}`)
  await page.screenshot({ path: join(SHOTS, 'vozes.png') })

  const synth = await page.evaluate(() => window.time.synthesize({ agentId: 'forja', text: 'Oi, eu sou o Forja.', name: 'Forja' }))
  const bytes = Buffer.from(synth.audio, 'base64')
  log('2 síntese macOS', synth.mime === 'audio/wav' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.length > 5000, `mime=${synth.mime} bytes=${bytes.length}`)

  await page.click('.voice-row:has-text("Forja") button:has-text("Ouvir")')
  await page.waitForSelector('.voice-row:has-text("Forja") button:has-text("Ouvir")', { timeout: 20_000 })
  log('3 prévia tocou e terminou', true, 'botão voltou a ▶ Ouvir')

  await page.click('.voices button:has-text("Fechar")')
  await page.click('button[aria-label="Silenciar vozes"]')
  const muted = await page.evaluate(() => window.time.voiceMuted())
  await page.click('button[aria-label="Ligar vozes"]')
  const unmuted = !(await page.evaluate(() => window.time.voiceMuted()))
  log('4 mudo', muted && unmuted, `mudo=${muted} religou=${unmuted}`)
  await page.screenshot({ path: join(SHOTS, 'topo.png') })
  log('5 sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | ') || 'nenhum')
} catch (e) {
  log('execução', false, e.message)
  await page.screenshot({ path: join(SHOTS, 'erro.png') }).catch(() => {})
} finally {
  await app.close()
}
process.exit(results.every(r => r.ok) ? 0 : 1)
