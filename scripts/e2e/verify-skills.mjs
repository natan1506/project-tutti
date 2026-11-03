// Verificação ponta a ponta das skills (plano skills, Task 6): dirige o app Electron real com Playwright.
// Cria uma skill com o Curinga (opencode gratuito), testa, ajusta, marca o Forja, faz um pedido curto ao Forja e apaga a skill no fim.
// Uso: npx electron-vite build && node scripts/e2e/verify-skills.mjs <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const [SHOTS] = process.argv.slice(2)
mkdirSync(SHOTS, { recursive: true })
const results = []
const log = (step, ok, detail) => { results.push({ step, ok, detail }); console.log(`${ok ? 'OK ' : 'FALHOU'} ${step}: ${detail}`) }
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })

const T = mkdtempSync(join(tmpdir(), 'tutti-skill-e2e-'))
execFileSync('git', ['init', '-q'], { cwd: T })
writeFileSync(join(T, 'README.md'), '# Projeto de teste\n\nUm app que lista tarefas, com login e exportação para CSV.\n')
execFileSync('git', ['add', '.'], { cwd: T })
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'inicio'], { cwd: T })

const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const userData = await app.evaluate(({ app }) => app.getPath('userData'))
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
let skillId

const busyGone = (label, ms = 300_000) => page.waitForFunction(l => {
  const b = [...document.querySelectorAll('.skills button')].find(x => x.textContent.startsWith(l))
  return !!b && !b.textContent.endsWith('…')
}, label, { timeout: ms })
const errText = () => page.locator('.skills .err').textContent().catch(() => '')

try {
  await page.evaluate(p => window.time.openProject(p), T)
  await page.click('.proj')
  await page.click(`.menu button:has-text("${basename(T)}")`)
  await page.waitForTimeout(2000)
  await page.click('button:has-text("Nova conversa")').catch(() => {})

  // 1 — criar com o Curinga
  await page.click('.prof')
  await page.click('.menu-action:has-text("Skills")')
  await page.waitForSelector('.modal.skills')
  await page.click('.skills .menu-action:has-text("Nova skill")')
  await page.fill('[aria-label="O que a skill deve fazer"]', 'Sempre que pedirem um resumo, responder em exatamente 3 tópicos curtos, começando cada um com um verbo.')
  await page.selectOption('[aria-label="Quem cria"]', 'curinga')
  await page.click('.skills button:has-text("Criar")')
  await busyGone('Criar')
  const name = await page.inputValue('[aria-label="Nome"]').catch(() => '')
  const body = await page.inputValue('[aria-label="Instruções"]').catch(() => '')
  log('1 criar', !!name && body.length > 20, `nome=${name} instruções=${body.length} caracteres ${await errText()}`)
  await shot(page, 'passo1-criada')

  // 2 — testar com o Curinga no projeto aberto
  await page.fill('[aria-label="Tarefa de exemplo"]', 'Resuma o README deste projeto.')
  await page.selectOption('[aria-label="Quem testa"]', 'curinga')
  await page.click('.skills button:has-text("Testar")')
  await busyGone('Testar')
  const answer = await page.locator('.skill-answer').textContent().catch(() => '')
  log('2 testar', !!answer && answer !== '(sem resposta)', `resposta=${JSON.stringify(answer.slice(0, 200))} ${await errText()}`)
  await shot(page, 'passo2-teste')

  // 3 — ajustar sem comentário (autoavaliação)
  await page.click('.skills button:has-text("Ajustar")')
  await busyGone('Ajustar')
  const body2 = await page.inputValue('[aria-label="Instruções"]')
  const e3 = await errText()
  log('3 ajustar', !e3 && body2.length > 20, `instruções=${body2.length} caracteres, mudou=${body2 !== body} ${e3}`)
  await shot(page, 'passo3-ajustada')

  // 4 — marcar o Forja e salvar
  await page.locator('.skills label:has-text("Forja") input[type=checkbox]').first().check()
  await page.click('.skills button:has-text("Salvar skill")')
  await page.waitForSelector(`.skills .profiles-list button:has-text("${name}")`)
  const saved = (await page.evaluate(() => window.time.skills())).find(s => s.name === name)
  skillId = saved?.id
  log('4 salvar', !!saved && saved.agentIds.includes('forja'), `agentIds=${saved?.agentIds}`)
  await shot(page, 'passo4-salva')
  await page.click('.skills .row.between button:has-text("Fechar")')

  // 5 — pedido curto ao Forja: o plugin tutti é gravado com a skill
  await page.click('.chip:has-text("Forja")')
  await page.fill('.inp textarea', 'Responda só: ok')
  await page.keyboard.press('Enter')
  const dir = join(userData, 'skill-plugins', 'forja', 'skills')
  for (let i = 0; i < 100 && !existsSync(join(dir, name, 'SKILL.md')); i++) await page.waitForTimeout(300)
  const files = existsSync(dir) ? readdirSync(dir) : []
  log('5 plugin do Forja', files.includes(name), `skills no plugin: ${files.join(', ')}`)
  await page.waitForFunction(() => {
    const s = [...document.querySelectorAll('.step')]
    return s.length > 0 && !s.at(-1).textContent.includes('trabalhando')
  }, null, { timeout: 240_000 }).catch(() => {})
  await shot(page, 'passo5-pedido')
  log('6 sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | ') || 'nenhum')
} catch (e) {
  log('execução', false, e.message)
  await shot(page, 'erro').catch(() => {})
} finally {
  if (skillId) await page.evaluate(id => window.time.deleteSkill(id), skillId).catch(() => {})
  writeFileSync(join(SHOTS, 'resultado.json'), JSON.stringify(results, null, 2))
  await app.close()
}
process.exit(results.every(r => r.ok) ? 0 : 1)
