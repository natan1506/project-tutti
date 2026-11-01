// Spike (revisão de perfis): comando rodado pelo opencode herda o env do servidor (e a chave no OPENCODE_CONFIG_CONTENT)?
// E o opencode lê a config de um opencode.json dentro de OPENCODE_CONFIG_DIR? Só chave FALSA e modelo gratuito.
// Uso: node scripts/spike/opencode-env-leak.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

async function serve(env) {
  const proc = spawn('opencode', ['serve', '--hostname=127.0.0.1', '--port=0'], { env })
  const base = await new Promise((res, rej) => {
    let b = ''; proc.stdout.on('data', d => { b += d; const m = b.match(/listening on (https?:\/\/\S+)/); if (m) res(m[1]) })
    setTimeout(() => rej(new Error('não subiu')), 20000)
  })
  const auth = { Authorization: 'Basic ' + Buffer.from('opencode:x').toString('base64'), 'content-type': 'application/json' }
  return { proc, base, auth }
}
const env = { ...process.env, PATH: `${join(homedir(), '.opencode/bin')}:${process.env.PATH}` }
for (const k of Object.keys(env)) if (/API_KEY|OPENCODE_/.test(k)) delete env[k]
const base = { ...env, OPENCODE_SERVER_PASSWORD: 'x', OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_AUTOUPDATE: '1' }

// (1) Config pelo arquivo opencode.json no OPENCODE_CONFIG_DIR
const dir1 = mkdtempSync(join(tmpdir(), 'leak-cfg-'))
writeFileSync(join(dir1, 'opencode.json'), JSON.stringify({ mcp: {}, plugin: [], provider: { openrouter: { options: { apiKey: 'sk-arquivo-falsa' } } } }), { mode: 0o600 })
const a = await serve({ ...base, OPENCODE_CONFIG_DIR: dir1 })
const prov = await (await fetch(a.base + '/api/provider', { headers: a.auth })).json()
console.log('arquivo no CONFIG_DIR lido:', JSON.stringify(prov.data.find(p => p.id === 'openrouter')?.settings ?? null))
a.proc.kill('SIGTERM')

// (2) Env do servidor chega ao comando?
const s = await serve({ ...base, OPENCODE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'leak-env-')), OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: {}, plugin: [], provider: { openrouter: { options: { apiKey: 'sk-env-falsa' } } } }) })
const work = mkdtempSync(join(tmpdir(), 'leak-work-'))
const sse = await fetch(s.base + '/api/event', { headers: s.auth })
const post = async (p, b) => (await fetch(s.base + p, { method: 'POST', headers: s.auth, body: JSON.stringify(b) })).json()
const sid = (await post('/api/session', { title: 'leak', location: { directory: work }, model: { providerID: 'opencode', id: 'big-pickle' }, permissions: [{ action: 'shell', resource: '*', effect: 'allow' }] })).data.id
await post(`/api/session/${sid}/prompt`, { text: 'Rode exatamente este comando no shell e mostre a saída: printenv OPENCODE_CONFIG_CONTENT | head -c 200 ; echo FIM' })
let out = ''
const dec = new TextDecoder(); let buf = ''
const t = setTimeout(() => process.exit(2), 120000)
for await (const ch of sse.body) {
  buf += dec.decode(ch, { stream: true }); out += ''
  if (/sk-env-falsa/.test(buf)) { console.log('VAZA: o comando viu a chave do servidor'); break }
  if (/session\.execution\.(succeeded|failed)/.test(buf)) { console.log('fim sem ver a chave; trechos com FIM:', (buf.match(/.{0,120}FIM.{0,40}/g) ?? []).slice(-2)); break }
}
clearTimeout(t)
s.proc.kill('SIGTERM')
process.exit(0)
