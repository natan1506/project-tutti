// Verificação ponta a ponta da autonomia e do Parar tudo (plano autonomia-parar-tudo, Task 6).
// Usa o Forja (Claude Code) de verdade, com pedidos curtos.
// Uso: npm run build && node scripts/e2e/verify-autonomia.mjs <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const [SHOTS] = process.argv.slice(2)
mkdirSync(SHOTS, { recursive: true })
const results = []
const log = (step, ok, detail) => { results.push({ step, ok, detail }); console.log(`${ok ? 'OK ' : 'FALHOU'} ${step}: ${detail}`) }
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })
const FORA = join(homedir(), 'tutti-e2e-fora.txt')
rmSync(FORA, { force: true })
const sleepRunning = () => { try { return execFileSync('pgrep', ['-f', 'sleep 60']).toString().trim() !== '' } catch { return false } }

const T = mkdtempSync(join(tmpdir(), 'tutti-autonomia-e2e-'))
execFileSync('git', ['init', '-q'], { cwd: T })
writeFileSync(join(T, 'README.md'), '# teste\n')
execFileSync('git', ['add', '.'], { cwd: T })
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'inicio'], { cwd: T })

const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

const level = nome => page.click(`.autonomy button:has-text("${nome}")`)
const activity = () => page.evaluate(() => window.time.activity())
async function ask(prompt) {
  await page.click('.chip:has-text("Forja")')
  await page.fill('.inp textarea', prompt)
  await page.keyboard.press('Enter')
  for (let i = 0; i < 50 && (await activity()) === 0; i++) await page.waitForTimeout(200)
}
/** Espera o pedido acabar; responde cartões de aprovação com `answer` e devolve os rótulos que apareceram. */
async function untilIdle(answer = 'Negar', ms = 240_000) {
  const labels = []
  const end = Date.now() + ms
  while (Date.now() < end) {
    const card = page.locator('.approval:not(.answered)').first()
    if (await card.count()) {
      labels.push(await card.locator('.label').textContent())
      await card.locator(`button:has-text("${answer}")`).click()
    }
    if ((await activity()) === 0) return labels
    await page.waitForTimeout(500)
  }
  throw new Error('pedido não terminou a tempo')
}

try {
  await page.evaluate(p => window.time.openProject(p), T)
  await page.click('.proj')
  await page.click(`.menu button:has-text("${basename(T)}")`)
  await page.waitForTimeout(2000)
  await page.click('button:has-text("Nova conversa")').catch(() => {})
  const tools = await page.evaluate(() => window.time.toolStatus())
  console.log('ferramentas:', JSON.stringify(Object.fromEntries(Object.entries(tools).map(([k, v]) => [k, `${v.installed ? 'instalado' : 'NÃO'}${v.loggedIn ? '' : ' sem login'} ${v.version ?? ''}`]))))

  // 1 — Sozinho: escreve no projeto sem perguntar; fora do projeto o sandbox barra
  await level('Sozinho')
  await ask("Rode exatamente `node -e \"require('fs').writeFileSync('ok.txt','1')\"` e depois `touch ~/tutti-e2e-fora.txt`, um comando por vez, e me diga o resultado de cada um.")
  const l1 = await untilIdle()
  const fora = existsSync(FORA)
  rmSync(FORA, { force: true })
  log('1 Sozinho com sandbox', existsSync(join(T, 'ok.txt')) && !fora && l1.length === 0, `ok.txt=${existsSync(join(T, 'ok.txt'))} fora=${fora} cartões=${JSON.stringify(l1)}`)
  await shot(page, 'passo1-sozinho')

  // 2 — destrutivo pede mesmo no Sozinho
  await ask('Rode exatamente `rm -f ok.txt` e me diga o resultado.')
  const l2 = await untilIdle('Negar')
  log('2 destrutivo pede', l2.some(l => l.includes('destrutivo ou irreversível')) && existsSync(join(T, 'ok.txt')), `cartões=${JSON.stringify(l2)} ok.txt=${existsSync(join(T, 'ok.txt'))}`)
  await shot(page, 'passo2-destrutivo')

  // 3 — Perguntar tudo: até criar um arquivo pede
  await level('Perguntar tudo')
  await ask('Crie o arquivo b.txt com o texto oi.')
  const l3 = await untilIdle('Negar')
  log('3 Perguntar tudo', l3.some(l => l.includes('você pediu para perguntar tudo')) && !existsSync(join(T, 'b.txt')), `cartões=${JSON.stringify(l3)} b.txt=${existsSync(join(T, 'b.txt'))}`)
  await shot(page, 'passo3-perguntar-tudo')

  // 4 — Parar tudo interrompe um comando longo sem deixar processo
  await level('Sozinho')
  await ask('Rode exatamente `sleep 60` e depois diga ok.')
  for (let i = 0; i < 60 && !sleepRunning(); i++) await page.waitForTimeout(500)
  const wasRunning = sleepRunning()
  const enabled = await page.isEnabled('.stop-all')
  await page.click('.stop-all')
  const t0 = Date.now()
  for (let i = 0; i < 40 && (await activity()) > 0; i++) await page.waitForTimeout(250)
  const stoppedIn = Date.now() - t0
  await page.waitForTimeout(1500)
  const leftover = sleepRunning()
  const disabled = !(await page.isEnabled('.stop-all'))
  log('4 Parar tudo', wasRunning && enabled && stoppedIn <= 10_000 && !leftover && disabled,
    `sleep rodando=${wasRunning} botão habilitado=${enabled} parou em ${stoppedIn} ms processo sobrando=${leftover} botão desabilitado depois=${disabled}`)
  await shot(page, 'passo4-parar-tudo')
  log('5 sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | ') || 'nenhum')
} catch (e) {
  log('execução', false, e.message)
  await shot(page, 'erro').catch(() => {})
} finally {
  rmSync(FORA, { force: true })
  writeFileSync(join(SHOTS, 'resultado.json'), JSON.stringify(results, null, 2))
  await app.close()
}
process.exit(results.every(r => r.ok) ? 0 : 1)
