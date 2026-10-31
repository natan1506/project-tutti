// Verificação ponta a ponta da Fase 1 (plano, Task 11): dirige o app Electron real com Playwright.
// Uso: node scripts/e2e/verify-fase1.mjs <pasta-de-teste> <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const [T, SHOTS] = process.argv.slice(2)
const results = []
const log = (step, ok, detail) => { results.push({ step, ok, detail }); console.log(`${ok ? 'OK ' : 'FALHOU'} ${step}: ${detail}`) }
const git = (...a) => execFileSync('git', a, { cwd: T, encoding: 'utf8' })

async function launch() {
  const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}
async function openProject(page) {
  await page.evaluate(p => window.time.openProject(p), T)
  await page.click('.proj')
  await page.click('.menu button:has-text("time-teste-fase1")')
  await page.waitForSelector('.inp textarea:not([disabled])')
}
async function ask(page, agent, prompt) {
  await page.click(`.chip:has-text("${agent}")`)
  await page.fill('.inp textarea', prompt)
  await page.keyboard.press('Enter')
}
const stepCount = page => page.locator('.step').count()
async function waitEnd(page, n) {
  await page.waitForFunction(n => {
    const s = [...document.querySelectorAll('.step')]
    return s.length >= n && !s[n - 1].textContent.includes('trabalhando')
  }, n, { timeout: 300_000 })
}
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })

let { app, page } = await launch()
await openProject(page)
await page.click('button:has-text("Nova conversa")')

// Passo 2 — Forja cria arquivo e roda npm test sem pedir aprovação
let n = (await stepCount(page)) + 1
await ask(page, 'Forja', 'Crie src/soma.js exportando soma(a,b) (ESM) e rode npm test. Responda curto.')
await waitEnd(page, n)
const approvals2 = await page.locator('.approval').count()
const soma1 = existsSync(join(T, 'src/soma.js')) ? readFileSync(join(T, 'src/soma.js'), 'utf8') : ''
const diff2 = await page.locator('.diff').last().textContent().catch(() => '')
log('2 Forja cria src/soma.js', soma1.includes('soma') && approvals2 === 0 && diff2.includes('src/soma.js'), `arquivo=${!!soma1} aprovações=${approvals2} diff="${diff2.slice(0, 80)}"`)
await shot(page, 'passo2')
await page.locator('.diff').last().locator('button:has-text("Manter tudo")').click()
git('add', '-A'); git('-c', 'user.name=Natan', '-c', 'user.email=n@x', 'commit', '-q', '-m', 'soma')

// Passo 3 — Pincel tenta instalar pacote; Natan nega
const pkgBefore = readFileSync(join(T, 'package.json'), 'utf8')
n = (await stepCount(page)) + 1
await ask(page, 'Pincel', 'Instale o pacote left-pad com npm. Se eu negar, apenas encerre dizendo que não instalou.')
await page.waitForSelector('.approval button:has-text("Negar")', { timeout: 300_000 })
const asked = await page.locator('.approval code').last().textContent()
await shot(page, 'passo3-aprovacao')
await page.locator('.approval button:has-text("Negar")').last().click()
await waitEnd(page, n)
const pkgAfter = readFileSync(join(T, 'package.json'), 'utf8')
log('3 aprovação negada', pkgAfter === pkgBefore && /install|add|\bi\b/.test(asked ?? ''), `pediu="${asked}" package.json inalterado=${pkgAfter === pkgBefore}`)
await shot(page, 'passo3')

// Passo 4 — Forja altera soma; Natan edita outra linha depois do pedido; Desfazer
// (edições feitas DURANTE o pedido entram no ponto final e são revertidas junto: limitação registrada no ledger)
n = (await stepCount(page)) + 1
await ask(page, 'Forja', 'Altere a função soma em src/soma.js para aceitar 3 números (a,b,c). Depois rode npm test. Responda curto.')
const t0 = Date.now()
while (Date.now() - t0 < 240_000 && readFileSync(join(T, 'src/soma.js'), 'utf8') === soma1) await new Promise(r => setTimeout(r, 200))
await waitEnd(page, n)
writeFileSync(join(T, 'src/soma.js'), '// nota do natan\n' + readFileSync(join(T, 'src/soma.js'), 'utf8'))
await page.locator('.diff').last().locator('.acts button', { hasText: 'Desfazer' }).click()
const card4 = page.locator('.diff').last()
await card4.locator('.note').waitFor({ timeout: 10_000 })
const note4 = await card4.locator('.note').textContent()
const soma4 = readFileSync(join(T, 'src/soma.js'), 'utf8')
log('4 desfazer preserva edição feita depois do pedido', !soma4.includes(', c') && soma4.includes('nota do natan'),
  `mudança do agente revertida=${!soma4.includes(', c')} nota do natan mantida=${soma4.includes('nota do natan')} aviso="${note4}"`)
await shot(page, 'passo4')
git('checkout', '--', '.')

// Passo 5 — Lupa revisa sem alterar nada
const status5 = git('status', '--porcelain')
n = (await stepCount(page)) + 1
await ask(page, 'Lupa', 'Revise src/soma.js. Responda curto.')
await waitEnd(page, n)
const lupaText = await page.locator('.msg-lupa .tx').last().textContent().catch(() => '')
const lupaDiff = await page.locator('.step').nth(n - 1).locator('xpath=following-sibling::div[contains(@class,"diff")][1]').count()
log('5 Lupa só lê', git('status', '--porcelain') === status5 && (lupaText ?? '').length > 0, `resposta="${(lupaText ?? '').slice(0, 100)}" git status igual=${git('status', '--porcelain') === status5} cardDiff=${lupaDiff}`)
await shot(page, 'passo5')

// Passo 6 — fechar o app no meio de um pedido e reabrir
n = (await stepCount(page)) + 1
await ask(page, 'Forja', 'Crie src/mult.js com mult(a,b) e testes em src/mult.test.js, e rode npm test.')
await page.waitForFunction(n => document.querySelectorAll('.step').length >= n, n)
await new Promise(r => setTimeout(r, 3000))
await app.close()
;({ app, page } = await launch())
await openProject(page)
await page.waitForSelector('.step')
const last = await page.locator('.step').last().textContent()
log('6 pedido interrompido aparece ao reabrir', last.includes('interrompido'), `último card="${last}"`)
await shot(page, 'passo6')
await app.close()

writeFileSync(join(SHOTS, 'resultado.json'), JSON.stringify(results, null, 2))
process.exit(results.every(r => r.ok) ? 0 : 1)
