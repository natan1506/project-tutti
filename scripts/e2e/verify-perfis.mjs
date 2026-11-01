// Verificação ponta a ponta dos perfis (plano perfis, Task 8): dirige o app Electron real com Playwright.
// Cria perfis de teste, usa uma chave FALSA da OpenRouter e apaga tudo no fim.
// Uso: node scripts/e2e/verify-perfis.mjs <pasta-de-teste> <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
const created = []

await page.evaluate(p => window.time.openProject(p), T)
await page.click('.proj')
await page.click('.menu button:has-text("time-teste-fase1")')
await page.waitForTimeout(2500)
await page.click('button:has-text("Nova conversa")').catch(() => {})
const projectId = await page.evaluate(async p => (await window.time.openProject(p)).project.id, T)

const steps = () => page.locator('.step').count()
const lastReply = () => page.locator('.side .msg .tx').last().textContent()
async function ask(agent, prompt) {
  await page.click(`.chip:has-text("${agent}")`)
  await page.fill('.inp textarea', prompt)
  await page.keyboard.press('Enter')
}
async function waitEnd(n, ms = 240_000) {
  await page.waitForFunction(n => {
    const s = [...document.querySelectorAll('.step')]
    return s.length >= n && !s[n - 1].textContent.includes('trabalhando')
  }, n, { timeout: ms })
}
const openConfig = async () => { await page.click('.prof'); await page.click('.menu-action:has-text("Configurar perfis")'); await page.waitForSelector('.modal.profiles') }
const closeConfig = () => page.click('.modal.profiles .row.between button:has-text("Fechar")')
const chooseProfile = async nome => { await page.click('.prof'); await page.click(`.menu button:has-text("${nome}")`); await page.waitForTimeout(800) }

try {
  // Passo 1 — duplicar o Padrão; o projeto lembra o perfil; outro projeto continua no Padrão
  await openConfig()
  await page.click('.profiles-list button:has-text("Padrão")')
  await page.click('.profile-edit button:has-text("Duplicar")')
  await page.waitForSelector('.profiles-list button:has-text("Padrão (cópia)")')
  created.push(...await page.evaluate(async () => (await window.time.profiles()).filter(p => p.nome === 'Padrão (cópia)').map(p => p.id)))
  await closeConfig()
  await chooseProfile('Padrão (cópia)')
  const stage1 = await page.locator('[data-agent]').count()
  const other = mkdtempSync(join(tmpdir(), 'tutti-outro-'))
  const otherProfile = await page.evaluate(async p => { const { project } = await window.time.openProject(p); return (await window.time.activeProfile(project.id)).nome }, other)
  const remembered = await page.evaluate(async id => (await window.time.activeProfile(id)).nome, projectId)
  log('1 duplicar e lembrar', stage1 === 6 && remembered === 'Padrão (cópia)' && otherProfile === 'Padrão', `mascotes=${stage1} projeto=${remembered} outro=${otherProfile}`)
  await shot(page, 'passo1-copia')

  // Passo 2 — perfil "Duo" do zero: Claudinho (CLI Claude), Kimi (API OpenRouter), Nuvem (Codex, só lê); sem coordenador
  await openConfig()
  await page.click('.profiles-list .menu-action:has-text("Novo perfil")')
  await page.fill('[aria-label="Nome do perfil"]', 'Duo')
  for (let i = 0; i < 2; i++) await page.click('.profile-edit button:has-text("Adicionar agente")')
  const form = i => page.locator('.agent-form').nth(i)
  await form(0).locator('[aria-label="Nome"]').fill('Claudinho')
  await form(0).locator('[aria-label="Função"]').fill('Geral')
  await form(0).locator('[aria-label="Prompt"]').fill('Você é o Claudinho, generalista. Responde curto.')
  await form(1).locator('[aria-label="Nome"]').fill('Kimi')
  await form(1).locator('[aria-label="Função"]').fill('Back-end')
  await form(1).locator('[aria-label="Prompt"]').fill('Você é o Kimi. Responde curto.')
  await form(1).locator('[aria-label="Transporte"]').selectOption('api')
  await form(1).locator('[aria-label="Modelo"]').fill('moonshotai/kimi-k3.1-pro')
  await form(2).locator('[aria-label="Nome"]').fill('Nuvem')
  await form(2).locator('[aria-label="Função"]').fill('Revisão')
  await form(2).locator('[aria-label="Prompt"]').fill('Você é o Nuvem, revisor. Só lê. Responde curto.')
  await form(2).locator('[aria-label="Transporte"]').selectOption('cli')
  await form(2).locator('[aria-label="Ferramenta"]').selectOption('codex')
  await form(2).locator('[aria-label="Só lê"]').check()
  const paidNote = await form(1).locator('.paid-note').textContent()
  await shot(page, 'passo2a-tela')
  await page.click('.profile-edit button:has-text("Salvar perfil")')
  await page.waitForSelector('.profiles-list button:has-text("Duo")')
  created.push(...await page.evaluate(async () => (await window.time.profiles()).filter(p => p.nome === 'Duo').map(p => p.id)))
  await closeConfig()
  await chooseProfile('Duo')
  const chips = await page.locator('.chip').allTextContents()
  const kimiTag = await page.locator('[data-agent]:has-text("Kimi")').textContent()
  const kimiChip = page.locator('.chip:has-text("Kimi")')
  log('2 perfil do zero', chips.join(',') === 'Claudinho,Kimi,Nuvem' && /Sem chave da OpenRouter/.test(kimiTag) && await kimiChip.isDisabled() && /cobrado/.test(paidNote),
    `chips=${chips.join(',')} kimi="${kimiTag}" aviso="${paidNote}"`)
  await shot(page, 'passo2b-palco')

  // Passo 3 — contexto compartilhado com ids novos
  let n = (await steps()) + 1
  await ask('Claudinho', 'Diga uma fruta qualquer em uma palavra. Não use ferramentas.')
  await waitEnd(n)
  const fruta = ((await lastReply()) ?? '').trim()
  n = (await steps()) + 1
  await ask('Nuvem', 'Qual fruta o Claudinho disse? Responda só a fruta. Não use ferramentas.')
  await waitEnd(n)
  const resposta = ((await lastReply()) ?? '').trim()
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')
  log('3 contexto entre agentes do perfil', !!norm(fruta) && norm(resposta).includes(norm(fruta)), `Claudinho="${fruta}" Nuvem="${resposta}"`)
  await shot(page, 'passo3-contexto')

  // Passo 4 — chave FALSA: Kimi fica disponível, pedido termina com erro legível; remover volta "Sem chave"
  await openConfig()
  await page.fill('[aria-label="Chave da OpenRouter"]', 'sk-or-teste-invalida')
  await page.locator('.key-row:has-text("OpenRouter") button:has-text("Salvar")').click()
  await page.waitForSelector('.key-row:has-text("OpenRouter") em:has-text("Chave salva")')
  await closeConfig()
  await page.waitForTimeout(800)
  const enabled = !(await kimiChip.isDisabled())
  n = (await steps()) + 1
  await ask('Kimi', 'Diga ok.')
  await waitEnd(n, 120_000)
  const kimiStep = (await page.locator('.step').nth(n - 1).textContent()) ?? ''
  const errText = await page.locator('.side .err, .side .msg.error, .side .note').allTextContents()
  await shot(page, 'passo4a-chave-falsa')
  await openConfig()
  await page.locator('.key-row:has-text("OpenRouter") button:has-text("Remover")').click()
  await page.waitForSelector('[aria-label="Chave da OpenRouter"]')
  await closeConfig()
  await page.waitForTimeout(800)
  const lockedAgain = await kimiChip.isDisabled()
  log('4 chave falsa', enabled && !/trabalhando/.test(kimiStep) && lockedAgain, `habilitado=${enabled} passo="${kimiStep.slice(0, 80)}" erro="${errText.join(' | ').slice(-160)}" travadoDepois=${lockedAgain}`)
} catch (e) {
  log('roteiro', false, String(e).slice(0, 300))
  await shot(page, 'erro').catch(() => {})
} finally {
  // Limpeza: perfis de teste e chave falsa saem; projeto volta ao Padrão.
  await page.evaluate(async ({ ids, projectId }) => {
    await window.time.setActiveProfile(projectId, 'padrao')
    for (const id of ids) await window.time.deleteProfile(id)
    const keys = await window.time.providerKeys()
    if (keys.openrouter) await window.time.removeProviderKey('openrouter')
  }, { ids: created, projectId }).catch(e => log('limpeza', false, String(e)))
  log('erros no console', errors.length === 0, errors.slice(0, 3).join(' | ') || 'nenhum')
  writeFileSync(join(SHOTS, 'resultado.json'), JSON.stringify(results, null, 2))
  await app.close()
}
process.exit(results.every(r => r.ok) ? 0 : 1)
