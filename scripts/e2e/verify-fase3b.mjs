// Verificação ponta a ponta da Fase 3B: aba Time, paralelo, fila, plano recusado, chamada ao Radar e cancelamento.
// Uso: node scripts/e2e/verify-fase3b.mjs <pasta-de-teste> <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [T, SHOTS] = process.argv.slice(2)
const results = []
const log = (step, ok, detail) => { results.push({ step, ok, detail }); console.log(`${ok ? 'OK ' : 'FALHOU'} ${step}: ${detail}`) }
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })
const git = (...a) => execFileSync('git', a, { cwd: T, encoding: 'utf8' })
const sleep = ms => new Promise(r => setTimeout(r, ms))

const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.evaluate(p => window.time.openProject(p), T)
await page.click('.proj')
await page.click('.menu button:has-text("time-teste-fase1")')
await page.waitForTimeout(3000)
await page.click('button:has-text("Nova conversa")').catch(() => {})

const pose = id => page.getAttribute(`[data-agent="${id}"]`, 'data-pose')
const busy = () => page.locator('button.link:has-text("Cancelar pedido")').count()
async function sendTeam(prompt) {
  await page.click('.chip:has-text("Time")')
  await page.fill('.inp textarea', prompt)
  await page.keyboard.press('Enter')
}
// Faz o papel do Natan nos passos de time: aprova os comandos que os agentes pedirem.
let autoApprove = true
const approvals = []
async function approvePending() {
  if (!autoApprove) return
  const btn = page.locator('.approval:not(.answered):not(.plan) button:has-text("Permitir")').first()
  if (await btn.count()) {
    approvals.push(await page.locator('.approval:not(.answered):not(.plan) code').first().textContent().catch(() => ''))
    await btn.click().catch(() => {})
  }
}
async function waitIdle(ms = 480_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    await approvePending()
    if ((await busy()) === 0 && (await page.locator('.note:has-text("Na fila")').count()) === 0) return true
    await sleep(500)
  }
  return false
}

// 1 + 3 — pedido de time com dois agentes em paralelo; segundo pedido vai para a fila
await sendTeam('Crie server/health.js (Node puro, ESM) exportando uma função health() que retorna {ok:true}, e crie web/status.html com uma página simples que diga "Status: ok". Responda curto.')
let parallel = false, sawThinkingAll = false, sawQueue = false
const t1 = Date.now()
await page.waitForSelector('.round', { timeout: 120_000 }).catch(() => {})
await shot(page, 'rodada')
await sendTeam('Crie web/sobre.html com uma frase dizendo "Feito pelo Tutti". Responda curto.')
while (Date.now() - t1 < 480_000) {
  const [f, p] = [await pose('forja'), await pose('pincel')]
  if (f === 'working' && p === 'working' && !parallel) { parallel = true; await shot(page, 'paralelo') }
  if (!sawQueue && (await page.locator('.note:has-text("Na fila (posição 1)")').count())) { sawQueue = true; await shot(page, 'fila') }
  if ((await page.locator('.chip-agent').count()) && (await busy()) === 0) break
  await approvePending()
  await sleep(300)
}
const idle1 = await waitIdle()
const bars = await page.locator('.round').first().locator('.prop').count()
const chips = await page.locator('.msg-bussola .chip-agent').first().locator('xpath=..').locator('.chip-agent').count()
log('1 pedido de time', idle1 && bars >= 4 && existsSync(join(T, 'server/health.js')) && existsSync(join(T, 'web/status.html')),
  `barras=${bars} chips na 1ª onda=${chips} paralelo observado=${parallel} aprovações dadas=${JSON.stringify(approvals).slice(0, 160)} health.js=${existsSync(join(T, 'server/health.js'))} status.html=${existsSync(join(T, 'web/status.html'))} erros=${errors.length}`)
log('3 fila', sawQueue && existsSync(join(T, 'web/sobre.html')), `viu "Na fila (posição 1)"=${sawQueue} sobre.html=${existsSync(join(T, 'web/sobre.html'))}`)
await shot(page, 'time-concluido')
git('add', '-A'); git('-c', 'user.name=Natan', '-c', 'user.email=n@x', 'commit', '-q', '-m', 'time')

// 2 — pedido grande com plano recusado
const status0 = git('status', '--porcelain')
await page.click('.chip:has-text("Time")')
await page.check('.hint .opt:has-text("forçar plano") input')
await sendTeam('Crie web/contato.html com um formulário de contato simples. Responda curto.')
await page.waitForSelector('.plan:not(.answered) button:has-text("Recusar")', { timeout: 300_000 })
const bussolaPose = await pose('bussola')
await shot(page, 'plano')
await page.click('.plan:not(.answered) button:has-text("Recusar")')
await waitIdle(120_000)
log('2 plano recusado', bussolaPose === 'waiting' && git('status', '--porcelain') === status0 && !existsSync(join(T, 'web/contato.html')),
  `Bússola ao pedir plano=${bussolaPose} nada alterado=${git('status', '--porcelain') === status0}`)
await page.uncheck('.hint .opt:has-text("forçar plano") input')

// 4 — Forja pergunta ao Radar
await page.click('[data-agent="forja"]')
await page.fill('.inp textarea', 'Use a ferramenta perguntar_ao_time para perguntar ao Radar qual é a versão LTS atual do Node.js, e me responda em uma linha com o que ele disse. Não crie arquivos.')
await page.keyboard.press('Enter')
let radarWorking = false
const t4 = Date.now()
while (Date.now() - t4 < 300_000) {
  if ((await pose('radar')) === 'working') { if (!radarWorking) await shot(page, 'radar-consultado'); radarWorking = true }
  const answered = await page.locator('.note.call:has-text("←")').count()
  const running = await page.locator('.step:has-text("trabalhando")').count()
  if (answered && !running) break
  await sleep(300)
}
const call = await page.locator('.note.call').last().textContent().catch(() => '')
log('4 chamada ao Radar', /perguntou ao Radar/.test(call ?? '') && /←/.test(call ?? '') && radarWorking, `radar trabalhando no palco=${radarWorking} chamada="${(call ?? '').slice(0, 160)}"`)

// 5 — cancelar pedido de time com dois filhos rodando
await sendTeam('Crie server/sum.js exportando sum(a,b) com testes em server/sum.test.js, e crie web/sum.html com um formulário que some dois números. Responda curto.')
let both = false
const t5 = Date.now()
while (Date.now() - t5 < 300_000) {
  if ((await pose('forja')) === 'working' && (await pose('pincel')) === 'working') { both = true; break }
  if ((await busy()) === 0) break
  await approvePending()
  await sleep(300)
}
await page.locator('button.link:has-text("Cancelar pedido")').last().click().catch(() => {})
const stopped = await waitIdle(60_000)
const poses = [await pose('forja'), await pose('pincel')]
log('5 cancelar pedido de time', stopped && poses.every(p => p === 'idle'), `dois trabalhando antes=${both} parou=${stopped} poses depois=${poses}`)
await shot(page, 'cancelado')

await app.close()
writeFileSync(join(SHOTS, 'resultado.json'), JSON.stringify(results, null, 2))
process.exit(results.every(r => r.ok) ? 0 : 1)
