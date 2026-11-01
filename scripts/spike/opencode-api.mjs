// Spike (perfis, Task 1): opencode 2.x com provedor por API e chave injetada só no processo do servidor.
// Uso: node scripts/spike/opencode-api.mjs [provedor] [modelo]
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const [provider = 'openrouter', modelArg] = process.argv.slice(2)
const env = { ...process.env, PATH: `${join(homedir(), '.opencode/bin')}:${process.env.PATH}` }
for (const k of Object.keys(env)) if (/API_KEY|OPENCODE_/.test(k)) delete env[k]
const password = randomBytes(18).toString('base64url')
const ids = ['openrouter', 'moonshotai', 'openai', 'anthropic', 'google', 'deepseek']
const config = { mcp: {}, plugin: [], provider: Object.fromEntries(ids.map(id => [id, { options: { apiKey: 'sk-teste-invalida' } }])) }
const proc = spawn('opencode', ['serve', '--hostname=127.0.0.1', '--port=0'], {
  env: { ...env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'spike-occ-')), OPENCODE_DISABLE_AUTOUPDATE: '1' },
})
process.on('exit', () => { try { proc.kill('SIGTERM') } catch {} })
const base = await new Promise((res, rej) => {
  let buf = ''
  proc.stdout.on('data', d => { buf += d; const m = buf.match(/listening on (https?:\/\/\S+)/); if (m) res(m[1]) })
  setTimeout(() => rej(new Error('servidor não subiu: ' + buf)), 20_000)
})
const auth = { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64') }
const get = async path => { const r = await fetch(base + path, { headers: auth }); return { status: r.status, text: await r.text() } }
const prov = JSON.parse((await get('/api/provider')).text).data
console.log('provedores:', prov.map(p => `${p.id}=${p.name}(${p.activation})`).join(', '))
console.log('campos do provedor:', Object.keys(prov[0]).join(','), '| settings:', Object.keys(prov[0].settings ?? {}).join(','))
const models = JSON.parse((await get('/api/model')).text).data
const by = {}; for (const m of models) (by[m.providerID] ??= []).push(m.modelID ?? m.id)
for (const [k, v] of Object.entries(by)) console.log('modelos', k, v.length, v.slice(0, 4).join(' | '))
console.log('campos do modelo:', Object.keys(models[0]).join(','))
const kimi = (by.openrouter ?? []).find(m => /kimi/.test(m)) ?? by[provider]?.[0]
const model = modelArg ?? kimi
console.log('modelo testado:', provider, model)
const dir = mkdtempSync(join(tmpdir(), 'spike-oca-'))
const ctl = new AbortController()
const sse = await fetch(base + '/api/event', { headers: auth, signal: ctl.signal })
const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() } }
const created = await post('/api/session', { title: 'spike', location: { directory: dir }, model: { providerID: provider, id: model }, permissions: [] })
console.log('sessão:', created.status, created.text.slice(0, 160))
const sid = JSON.parse(created.text).data.id
console.log('prompt:', (await post(`/api/session/${sid}/prompt`, { text: 'diga ok' })).status)
const dec = new TextDecoder(); let buf = ''; const seen = []
const deadline = setTimeout(() => ctl.abort(), 30_000)
try {
  for await (const chunk of sse.body) {
    buf += dec.decode(chunk, { stream: true }); let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2)
      const data = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
      if (!data) continue
      let ev; try { ev = JSON.parse(data) } catch { continue }
      const type = ev.type ?? ev.event
      if (/delta|updated$/.test(type ?? '')) continue
      seen.push(type)
      if (/error|failed|succeeded|ended/i.test(type ?? '')) console.log('[ev]', type, JSON.stringify(ev.data ?? ev.properties ?? {}).slice(0, 400))
      if (/execution\.(succeeded|failed)/.test(type ?? '')) throw 'fim'
    }
  }
} catch (e) { if (e !== 'fim' && e?.name !== 'AbortError') console.log('erro', e) }
clearTimeout(deadline)
console.log('tipos:', [...new Set(seen)].join(', '))
proc.kill('SIGTERM')
process.exit(0)
