// Pacote só do terminal (sem o app): release/tutti-cli-darwin-<arch>.tar.gz com o `tutti` já montado e só as
// dependências de produção. Os binários do Claude Code e do Codex ficam de fora: usa os que a pessoa já tem instalados.
// Uso: npx electron-vite build && node scripts/pack-cli.mjs
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
if (!existsSync(join(root, 'out/main/cli.js'))) throw new Error('Rode o build antes (npx electron-vite build).')
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const stage = join(root, 'release', 'cli-stage')
const pkg = join(stage, 'tutti')
rmSync(stage, { recursive: true, force: true })
mkdirSync(pkg, { recursive: true })
cpSync(join(root, 'out', 'main'), join(pkg, 'out', 'main'), { recursive: true })
for (const f of ['package.json', 'package-lock.json']) cpSync(join(root, f), join(pkg, f))
// Sem scripts: o postinstall do projeto é do app (nome do app em dev), não do terminal.
// Sem os binários embutidos dos SDKs (opcionais, ~650 MB): o terminal usa o `claude` e o `codex` instalados na máquina.
execFileSync('npm', ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: pkg, stdio: 'inherit' })
const out = join(root, 'release', `tutti-cli-darwin-${arch}.tar.gz`)
execFileSync('tar', ['-czf', out, '-C', stage, 'tutti'])
rmSync(stage, { recursive: true, force: true })
console.log(`${out} (${Math.round(statSync(out).size / 1048576)} MB)`)
