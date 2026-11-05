// Mede o gasto do Tutti parado: CPU e memória por processo (app.getAppMetrics), nas vistas Palco e Escritório.
// Uso: npm run build && node scripts/e2e/perf.mjs [segundos] [pasta-de-prints]
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SECS = Number(process.argv[2] ?? 15)
const SHOTS = process.argv[3] // pasta opcional para prints de cada vista
const T = mkdtempSync(join(tmpdir(), 'tutti-perf-'))
execFileSync('git', ['init', '-q'], { cwd: T })
writeFileSync(join(T, 'README.md'), '# perf\n')

const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')

const MAIN = app.process().pid
/** Árvore de processos do app inteira, inclusive CLIs filhas, que o getAppMetrics não enxerga. */
const tree = () => {
  const rows = execFileSync('ps', ['-Ao', 'pid=,ppid=,time=,rss=,comm='], { encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').map(l => {
    const [, pid, ppid, time, rss, comm] = l.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/)
    const [m, sec] = time.split(':')
    return { pid: +pid, ppid: +ppid, cpu: +m * 60 + +sec, rss: +rss, comm: comm.split('/').pop() }
  })
  const inTree = new Set([MAIN])
  for (let again = true; again;) { again = false; for (const r of rows) if (inTree.has(r.ppid) && !inTree.has(r.pid)) { inTree.add(r.pid); again = true } }
  return rows.filter(r => inTree.has(r.pid))
}
const drawStats = () => page.evaluate(() => new Promise(res => {
  const P = WebGL2RenderingContext.prototype
  const stats = window.__draws ??= { calls: 0, tris: 0 }
  if (!window.__patched) {
    window.__patched = true
    for (const name of ['drawElements', 'drawArrays']) {
      const orig = P[name]
      P[name] = function (mode, a, b) { stats.calls++; stats.tris += (name === 'drawElements' ? b : b) / 3; return orig.apply(this, arguments) }
    }
  }
  stats.calls = 0; stats.tris = 0; let frames = 0; const t0 = performance.now()
  const f = () => { frames++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : res({ calls: Math.round(stats.calls / frames), tris: Math.round(stats.tris / frames), canvases: document.querySelectorAll('canvas').length }) }
  requestAnimationFrame(f)
}))

const sample = async label => {
  await page.waitForTimeout(3000)
  await app.evaluate(({ app }) => app.getAppMetrics()) // zera a janela do percentCPUUsage
  const before = tree(), seen = new Set()
  const t0 = Date.now()
  while (Date.now() - t0 < SECS * 1000) { await page.waitForTimeout(500); for (const r of tree()) if (!before.some(b => b.pid === r.pid)) seen.add(r.comm) }
  const after = tree()
  const secs = (Date.now() - t0) / 1000
  const d = await drawStats()
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${label.split(' ')[0]}.png`) })
  console.log(`\n${label}: ${await page.locator('.office-tag').count()} etiquetas de escritório · ${d.canvases} canvas · ${d.calls} draw calls/quadro · ${d.tris} triângulos/quadro`)
  console.log(`  ps (árvore): ${after.map(r => { const b = before.find(x => x.pid === r.pid); return `${r.comm} ${(((r.cpu - (b?.cpu ?? 0)) / secs) * 100).toFixed(0)}% ${(r.rss / 1024).toFixed(0)}MB` }).join(' | ')}`)
  console.log(`  filhos novos na janela: ${[...seen].join(', ') || 'nenhum'}`)
  const m = await app.evaluate(({ app }) => app.getAppMetrics().map(p => ({ type: p.type, cpu: p.cpu.percentCPUUsage, mem: p.memory.workingSetSize })))
  const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : res(Math.round(n / 2)) }; requestAnimationFrame(f) }))
  const total = m.reduce((a, p) => a + p.cpu, 0)
  const mem = m.reduce((a, p) => a + p.mem, 0)
  console.log(`\n${label}: CPU total ${total.toFixed(1)}% · memória ${(mem / 1024).toFixed(0)} MB · rAF ${fps}/s`)
  for (const p of m) console.log(`  ${p.type.padEnd(14)} ${p.cpu.toFixed(1).padStart(6)}%  ${(p.mem / 1024).toFixed(0).padStart(5)} MB`)
}

try {
  await page.evaluate(p => window.time.openProject(p), T)
  await page.reload()
  await page.waitForTimeout(3000)
  await page.locator('button:has-text("Palco")').first().click()
  await sample('Palco parado')
  await page.locator('button:has-text("Escritório")').first().click()
  await sample('Escritório parado')
} finally { await app.close() }
