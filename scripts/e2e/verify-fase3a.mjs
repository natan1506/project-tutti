// Verificação ponta a ponta da Fase 3A: Radar (Antigravity), Curinga (opencode), conversa contínua, pergunta e cancelamento.
// Uso: node scripts/e2e/verify-fase3a.mjs <pasta-de-teste> <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [T, SHOTS] = process.argv.slice(2)
const results = []
const log = (step, ok, detail) => { results.push({ step, ok, detail }); console.log(`${ok ? 'OK ' : 'FALHOU'} ${step}: ${detail}`) }
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })
const git = (...a) => execFileSync('git', a, { cwd: T, encoding: 'utf8' })
const pgrep = pat => { try { return execFileSync('pgrep', ['-f', pat], { encoding: 'utf8' }).trim() } catch { return '' } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

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

const pose = id => page.getAttribute(`[data-agent="${id}"]`, 'data-pose')
const steps = () => page.locator('.step').count()
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
const lastText = agent => page.locator(`.msg-${agent} .tx`).last().textContent().catch(() => '')

// 1 — elenco completo
const p1 = [await pose('radar'), await pose('curinga')]
log('1 elenco completo', p1.every(p => p !== 'locked') && errors.length === 0, `radar/curinga=${p1} erros=${JSON.stringify(errors).slice(0, 200)}`)
await shot(page, 'elenco')

// 2 — Radar pesquisa sem alterar nada
const status0 = git('status', '--porcelain')
let n = (await steps()) + 1
await ask('radar', 'Pesquise na web a versão LTS atual do Node.js e responda em uma linha, citando o link da fonte.')
const seenRadar = new Set()
const t2 = Date.now()
while (Date.now() - t2 < 300_000) {
  seenRadar.add(await pose('radar'))
  const s = page.locator('.step').nth(n - 1)
  if ((await s.count()) && !(await s.textContent()).includes('trabalhando')) break
  await sleep(300)
}
const radarText = await lastText('radar')
log('2 Radar pesquisa', /https?:\/\//.test(radarText ?? '') && git('status', '--porcelain') === status0,
  `poses=${[...seenRadar].join(',')} resposta="${(radarText ?? '').slice(0, 140)}" git inalterado=${git('status', '--porcelain') === status0}`)
await shot(page, 'radar')

// 3 — Curinga cria arquivo e pede aprovação do npm install (negada)
n = (await steps()) + 1
await ask('curinga', 'Crie o arquivo src/mult.js exportando mult(a,b) em ESM. Depois rode o comando `npm install left-pad`. Responda curto.')
await page.waitForSelector('.approval:not(.answered) button:has-text("Negar")', { timeout: 300_000 })
const asked = await page.locator('.approval:not(.answered) code').last().textContent()
await shot(page, 'curinga-aprovacao')
await page.locator('.approval:not(.answered) button:has-text("Negar")').last().click()
await waitEnd(n)
const pkg = readFileSync(join(T, 'package.json'), 'utf8')
log('3 Curinga com aprovação', existsSync(join(T, 'src/mult.js')) && !pkg.includes('left-pad') && /npm install left-pad/.test(asked ?? ''),
  `pediu="${asked}" mult.js=${existsSync(join(T, 'src/mult.js'))} left-pad no package.json=${pkg.includes('left-pad')}`)

// 4 — conversa contínua
n = (await steps()) + 1
await ask('forja', 'Crie src/sub.js exportando sub(a,b) em ESM. Responda curto.')
await waitEnd(n)
n = (await steps()) + 1
await ask('forja', 'Qual arquivo você acabou de criar? Responda só o caminho.')
await waitEnd(n)
const memo = await lastText('forja')
log('4 conversa contínua', /src\/sub\.js/.test(memo ?? ''), `resposta="${(memo ?? '').slice(-120)}"`)

// 5 — pergunta em texto livre
n = (await steps()) + 1
await ask('forja', 'Antes de criar qualquer arquivo, use a ferramenta de perguntas (AskUserQuestion) para me perguntar qual nome dar ao arquivo. Depois crie em src/ o arquivo com o nome que eu responder, contendo `export const ok = true`. Responda curto.')
await page.waitForSelector('.question:not(.answered)', { timeout: 300_000 })
const waitingPose = await pose('forja')
await shot(page, 'pergunta')
await page.fill('.question:not(.answered) input.answer', 'pergunta-ok.js')
await page.click('.question:not(.answered) button:has-text("Responder")')
await waitEnd(n)
log('5 pergunta', waitingPose === 'waiting' && existsSync(join(T, 'src/pergunta-ok.js')),
  `pose ao perguntar=${waitingPose} arquivo criado=${existsSync(join(T, 'src/pergunta-ok.js'))}`)

// 6 — cancelar o Radar mata o processo agy
n = (await steps()) + 1
await ask('radar', 'Faça uma pesquisa detalhada sobre o histórico de versões do Node.js de 2015 até hoje, com tabela e fontes.')
await sleep(3000)
const before6 = pgrep('agy -p')
await page.locator('.log button.link:has-text("Cancelar")').last().click()
let gone = false
for (let i = 0; i < 30 && !gone; i++) { await sleep(100); gone = pgrep('agy -p') === '' }
log('6 cancelar Radar', before6 !== '' && gone, `agy rodando antes=${before6 !== ''} morreu em até 3 s=${gone}`)
await waitEnd(n, 30_000).catch(() => {})

// 7 — fechar o app não deixa o servidor do opencode órfão
const serverBefore = pgrep('opencode serve --hostname=127.0.0.1 --port=0')
await app.close()
let clean = false
for (let i = 0; i < 60 && !clean; i++) { await sleep(100); clean = pgrep('opencode serve --hostname=127.0.0.1 --port=0') === '' }
log('7 sem órfão do opencode', serverBefore !== '' && clean, `servidor rodando antes=${serverBefore !== ''} sumiu em até 6 s=${clean}`)

writeFileSync(join(SHOTS, 'resultado.json'), JSON.stringify(results, null, 2))
process.exit(results.every(r => r.ok) ? 0 : 1)
