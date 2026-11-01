// Print do palco com um perfil de 3 agentes e da tela de perfis (sem pedidos: não gasta cota). Apaga o perfil no fim.
// Uso: node scripts/e2e/verify-perfis-palco.mjs <pasta-de-teste> <pasta-de-prints>
import { _electron as electron } from 'playwright'
import { join } from 'node:path'

const [T, SHOTS] = process.argv.slice(2)
const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const { project } = await page.evaluate(p => window.time.openProject(p), T)
await page.click('.proj')
await page.click('.menu button:has-text("time-teste-fase1")')
await page.waitForTimeout(2000)
const r = await page.evaluate(() => window.time.saveProfile({
  id: '', nome: 'Duo', builtin: false, defaults: { transport: { kind: 'cli', tool: 'claude' } },
  agents: [
    { id: 'n1', nome: 'Claudinho', prompt: 'x', funcao: 'Geral', readOnly: false, reviewer: false, consultable: false },
    { id: 'n2', nome: 'Kimi', prompt: 'x', funcao: 'Geral', readOnly: false, reviewer: false, consultable: false, transport: { kind: 'api', provider: 'openrouter' }, model: 'moonshotai/kimi-k3.1-pro' },
    { id: 'n3', nome: 'Nuvem', prompt: 'x', funcao: 'Revisão', readOnly: true, reviewer: true, consultable: true, transport: { kind: 'cli', tool: 'codex' } },
  ],
}))
try {
  await page.click('.prof'); await page.click('.menu button:has-text("Duo")'); await page.waitForTimeout(2000)
  await page.screenshot({ path: join(SHOTS, 'palco-3-agentes.png') })
  await page.click('.prof'); await page.click('.menu-action:has-text("Configurar perfis")'); await page.waitForTimeout(800)
  await page.screenshot({ path: join(SHOTS, 'tela-perfis.png') })
} finally {
  await page.evaluate(async ({ id, pid }) => { await window.time.setActiveProfile(pid, 'padrao'); await window.time.deleteProfile(id) }, { id: r.profile.id, pid: project.id })
  await app.close()
}
