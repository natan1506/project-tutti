// Abre o Tutti instalado em /Applications com o PATH mínimo do Finder e lista nome, ferramentas e uso.
// Uso: node scripts/e2e/verify-pacote.mjs <print.png>
import { _electron as electron } from 'playwright'
const app = await electron.launch({ executablePath: '/Applications/Tutti.app/Contents/MacOS/Tutti', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, USER: process.env.USER } })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(4000)
console.log('nome', await app.evaluate(({ app }) => [app.getName(), app.isPackaged, app.getPath('userData')]))
console.log('ferramentas', JSON.stringify(await page.evaluate(() => window.time.toolStatus())))
console.log('uso', JSON.stringify((await page.evaluate(() => window.time.usageSnapshot())).rows.map(r => [r.tool, r.utilization])))
await page.screenshot({ path: process.argv[2] })
await app.close()
