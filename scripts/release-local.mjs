// Plano B do Release: monta os .dmg neste Mac e publica na release da tag atual, sem depender de máquina do GitHub.
// Uso:
//   npm run release:local                 os dois instaladores (arm64 e x64)
//   npm run release:local -- --arch x64   só um
//   npm run release:local -- --dry-run    monta, mas não envia
// Precisa: árvore limpa, tag vX.Y.Z = versão do package.json já enviada ao GitHub, e `gh` logado.
// Os SDKs trazem binários por arquitetura: para a outra arquitetura o script reinstala node_modules com --cpu e,
// no fim, volta as dependências da arquitetura deste Node.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { cleanStrayApps } from './lib/stray-apps.mjs'

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const only = args.includes('--arch') ? args[args.indexOf('--arch') + 1] : undefined

const archs = only ? [only] : ['arm64', 'x64']
if (only && !['arm64', 'x64'].includes(only)) { console.error('--arch deve ser arm64 ou x64'); process.exit(1) }
const native = process.arch === 'arm64' ? 'arm64' : 'x64'

/** Erro de uso: só a mensagem, sem o rastro do Node. */
const fail = msg => { console.error(`\n✗ ${msg}`); process.exit(1) }
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: 'inherit', ...opts })
const out = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8' }).trim()
const step = msg => console.log(`\n▸ ${msg}`)

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const tag = `v${version}`

step(`Conferindo ${tag}`)
if (out('git', ['status', '--porcelain', '--untracked-files=no']).split('\n').some(l => l && !l.endsWith('.tsbuildinfo')))
  fail('Há alterações sem commit: faça o commit antes de lançar.')
if (out('git', ['tag', '--list', tag]) !== tag) fail(`A tag ${tag} não existe. Crie com: git tag ${tag} && git push origin ${tag}`)
if (!out('git', ['ls-remote', '--tags', 'origin', tag])) fail(`A tag ${tag} não está no GitHub. Envie com: git push origin ${tag}`)
if (out('git', ['rev-parse', 'HEAD']) !== out('git', ['rev-list', '-n', '1', tag])) fail(`O commit atual não é o da tag ${tag}.`)
out('gh', ['auth', 'status'])

const files = []
let swapped = false
try {
  step('Compilando a interface')
  run('npx', ['electron-vite', 'build'])
  // A arquitetura deste Node primeiro: não precisa reinstalar nada.
  for (const arch of [...archs].sort(a => (a === native ? -1 : 1))) {
    if (arch !== native) {
      step(`Instalando as dependências ${arch}`)
      run('npm', ['ci', `--cpu=${arch}`, '--os=darwin'])
      swapped = true
    }
    step(`Montando o .dmg ${arch}`)
    const dmg = join('release', `Tutti-${version}-${arch}.dmg`)
    rmSync(dmg, { force: true })
    run('npx', ['electron-builder', '--mac', `--${arch}`, '--publish', 'never'])
    if (!existsSync(dmg)) throw new Error(`O electron-builder não gerou ${dmg}`)
    files.push(dmg)
  }
} finally {
  // O electron-builder deixa um Tutti.app em release/mac*: sem isso o macOS passa a listar mais um Tutti.
  cleanStrayApps()
  if (swapped) {
    step(`Voltando as dependências para ${native}`)
    run('npm', ['ci'])
  }
}

if (dry) {
  step(`Ensaio: nada enviado. Gerados: ${files.join(', ')}`)
} else {
  let exists = true
  try { out('gh', ['release', 'view', tag]) } catch { exists = false }
  step(exists ? `Completando a release ${tag}` : `Criando a release ${tag}`)
  if (exists) run('gh', ['release', 'upload', tag, ...files, '--clobber'])
  else run('gh', ['release', 'create', tag, ...files, '--title', `Tutti ${version}`, '--generate-notes'])
  step(`Pronto: ${out('gh', ['release', 'view', tag, '--json', 'url', '-q', '.url'])}`)
}
