// Verificação ponta a ponta do uso, gatilho de limite e contexto compartilhado (plano uso-gatilho-contexto, Task 7).
// Uso: node scripts/e2e/verify-uso.mjs <pasta-de-teste> <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [T, SHOTS] = process.argv.slice(2)
const results = []
const log = (step, ok, detail) => { results.push({ step, ok, detail }); console.log(`${ok ? 'OK ' : 'FALHOU'} ${step}: ${detail}`) }
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })

const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.evaluate(p => window.time.openProject(p), T)
await page.click('.proj')
await page.click('.menu button:has-text("time-teste-fase1")')
await page.waitForTimeout(3000)
await page.click('button:has-text("Nova conversa")').catch(() => {})

const steps = () => page.locator('.step').count()
const stepText = i => page.locator('.step').nth(i).textContent()
const lastReply = () => page.locator('.side .msg .tx').last().textContent()
async function ask(agent, prompt) {
  await page.click(`[data-agent="${agent}"]`)
  await page.fill('.inp textarea', prompt)
  await page.keyboard.press('Enter')
}
async function waitEnd(n, ms = 300_000) {
  await page.waitForFunction(n => {
    const s = [...document.querySelectorAll('.step')]
    return s.length >= n && !s[n - 1].textContent.includes('trabalhando')
  }, n, { timeout: ms })
}
const tokens = async tool => {
  const s = await page.evaluate(() => window.time.usageSnapshot())
  const r = s.rows.find(r => r.tool === tool)
  return r ? r.tokens.input + r.tokens.output : 0
}

// Passo 1 — painel com as quatro linhas
await page.waitForSelector('.usage-panel .usage-row')
const rows = await page.locator('.usage-row').count()
const claudePct = await page.locator('.usage-row[data-tool="claude"] .usage-pct').textContent()
log('1 painel no canto', rows === 4, `linhas=${rows} claude="${claudePct}"`)
await shot(page, 'passo1-painel')

// Passos 2 e 3 — tokens sobem e o Radar sabe o que o Forja disse
const c0 = await tokens('claude'), g0 = await tokens('gemini')
let n = (await steps()) + 1
await ask('forja', 'Diga uma cor qualquer em uma palavra. Não use ferramentas.')
await waitEnd(n)
const forjaText = (await lastReply()) ?? ''
const c1 = await tokens('claude')
log('2a tokens do Claude sobem', c1 > c0, `${c0} → ${c1}`)
n = (await steps()) + 1
await ask('radar', 'Qual cor o Forja disse? Responda só a cor.')
await waitEnd(n)
const radarText = (await lastReply()) ?? ''
const g1 = await tokens('gemini')
log('2b tokens do Antigravity sobem', g1 > g0, `${g0} → ${g1}`)
const cores = ['azul', 'verde', 'vermelho', 'amarelo', 'roxo', 'laranja', 'preto', 'branco', 'rosa', 'cinza', 'marrom', 'violeta', 'turquesa', 'ciano', 'magenta', 'dourado', 'prata', 'índigo', 'lilás', 'bege', 'vinho', 'coral']
const cor = cores.find(c => forjaText.toLowerCase().includes(c))
log('3 contexto compartilhado', !!cor && radarText.toLowerCase().includes(cor), `forja="${forjaText.slice(-60)}" radar="${radarText.slice(-60)}"`)
await shot(page, 'passo3-contexto')

// Passo 4 — gatilho: avisar em 1% no Claude, pedido ao Forja, [Passar]
await page.click('.usage-head button:has-text("Uso")')
await page.fill('[data-setting="alert-claude"]', '1')
await page.locator('[data-setting="alert-claude"]').blur()
await page.waitForTimeout(500)
await shot(page, 'passo4a-detalhe')
await page.click('.usage-detail button:has-text("Fechar")')
const before = await steps()
await ask('forja', 'Rode o comando `sleep 45` no terminal e depois responda apenas: pronto.')
const card = await page.waitForSelector('.approval.limit:not(.answered)', { timeout: 180_000 }).then(() => true, () => false)
const cardText = card ? await page.locator('.approval.limit:not(.answered)').last().textContent() : ''
log('4a aviso de limite no chat', card && /Posso passar o trabalho do Forja/.test(cardText), cardText.slice(0, 160))
await shot(page, 'passo4b-aviso')
const passBtn = page.locator('.approval.limit:not(.answered) button:has-text("Passar")')
const canPass = card && await passBtn.first().waitFor({ timeout: 5000 }).then(() => true, () => false)
if (card && !canPass) log('4b trabalho passado', false, `sem botão Passar: cartões=${await page.locator('.approval.limit').count()} abertos=${await page.locator('.approval.limit:not(.answered)').count()} passos=${(await page.locator('.step').allTextContents()).join(' | ')}`)
if (canPass) {
  await page.click('.approval.limit:not(.answered) button:has-text("Passar")')
  await page.waitForFunction(b => document.querySelectorAll('.step').length >= b + 2, before, { timeout: 60_000 }).catch(() => {})
  const total = await steps()
  const approve = setInterval(() => void page.locator('.approval:not(.limit) button:has-text("Permitir")').first().click({ timeout: 1000 }).catch(() => {}), 2000)
  await waitEnd(total).finally(() => clearInterval(approve))
  const oldText = (await stepText(before)) ?? ''
  const newText = (await stepText(total - 1)) ?? ''
  const note = await page.locator('.side .note:has-text("Trabalho passado para o")').count()
  log('4b trabalho passado', note > 0 && /cancelado/.test(oldText) && !newText.includes('trabalhando'), `antigo="${oldText.slice(0, 100)}" novo="${newText.slice(0, 100)}"`)
  await shot(page, 'passo4c-passado')
}
await page.evaluate(() => window.time.updateUsageSettings({ alertAt: 90, perTool: { claude: { alertAt: null } } }))
const after = await page.evaluate(() => window.time.usageSettings())
log('4c ajuste voltou', after.alertAt === 90 && after.perTool.claude?.alertAt === undefined, JSON.stringify(after))

log('erros no console', errors.length === 0, errors.slice(0, 3).join(' | ') || 'nenhum')
writeFileSync(join(SHOTS, 'resultado.json'), JSON.stringify(results, null, 2))
await app.close()
process.exit(results.every(r => r.ok) ? 0 : 1)
