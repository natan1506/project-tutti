// Spike: opencode 2.x falando direto com a API HTTP /api/... (o SDK 1.19 do npm não serve para o CLI 2.x).
// Uso: node scripts/spike/opencode.mjs <modelo> <arquivo-de-eventos.json>
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const [modelID = 'big-pickle', outFile = '/tmp/opencode-events.json'] = process.argv.slice(2)
const dir = mkdtempSync(join(tmpdir(), 'spike-oc-'))
writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"1.0.0"}\n')
const env = { ...process.env, PATH: `${join(homedir(), '.opencode/bin')}:${process.env.PATH}` }
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete env[k]

const password = randomBytes(18).toString('base64url')
const proc = spawn('opencode', ['serve', '--hostname=127.0.0.1', '--port=0'], {
  env: { ...env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: {} }) },
})
const stop = () => { try { proc.kill('SIGTERM') } catch {} }
process.on('exit', stop)
const base = await new Promise((res, rej) => {
  let buf = ''
  proc.stdout.on('data', d => { buf += d; const m = buf.match(/listening on (https?:\/\/\S+)/); if (m) res(m[1]) })
  setTimeout(() => rej(new Error('servidor não subiu: ' + buf)), 20_000)
})
const auth = { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64') }
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { ...auth, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

const events = []
const ctl = new AbortController()
const sse = await fetch(base + '/api/event', { headers: auth, signal: ctl.signal })
const session = (await api('POST', '/api/session', {
  title: 'spike', location: { directory: dir }, model: { providerID: 'opencode', id: modelID },
  permissions: [{ action: 'shell', resource: '*', effect: 'ask' }, { action: 'edit', resource: '*', effect: 'allow' }],
})).data
console.log('session', JSON.stringify(session).slice(0, 200))

let idle = false
const reader = (async () => {
  const dec = new TextDecoder(); let buf = ''
  for await (const chunk of sse.body) {
    buf += dec.decode(chunk, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2)
      const data = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
      if (!data) continue
      let ev; try { ev = JSON.parse(data) } catch { continue }
      if (typeof ev === 'string') try { ev = JSON.parse(ev) } catch {}
      events.push(ev)
      const type = ev.type ?? ev.event ?? ev._tag
      const sid = ev.properties?.sessionID ?? ev.data?.sessionID ?? ev.sessionID
      if (sid && sid !== session.id) continue
      if (!/updated$|delta$/.test(type ?? '')) console.log('[ev]', type, JSON.stringify(ev.data ?? {}).slice(0, 200))
      if (/permission/i.test(type ?? '') && /ask|request|created/i.test(type ?? '')) {
        const id = ev.properties?.id ?? ev.data?.id ?? ev.id ?? ev.requestID ?? ev.properties?.requestID ?? ev.data?.requestID
        console.log('  → rejeitando', id)
        await api('POST', `/api/session/${session.id}/permission/${id}/reply`, { decision: 'reject', message: 'Natan negou' }).catch(e => console.log('  reply falhou', e.message))
      }
      if (/^session\.execution\.(succeeded|failed|cancelled|interrupted)$/.test(type ?? '') || type === 'session.idle') { idle = true; return }
    }
  }
})().catch(e => { if (e.name !== 'AbortError') console.log('sse erro', e.message) })

await api('POST', `/api/session/${session.id}/prompt`, { text: 'Crie o arquivo a.txt com "a". Depois rode o comando `npm install left-pad`. Responda curto em português.' })
await Promise.race([reader, new Promise(r => setTimeout(r, 180_000))])
ctl.abort()
console.log('idle?', idle, 'a.txt?', existsSync(join(dir, 'a.txt')), 'left-pad?', readFileSync(join(dir, 'package.json'), 'utf8').includes('left-pad'))
writeFileSync(outFile, JSON.stringify(events, null, 1))
stop()
setTimeout(() => process.exit(0), 500)
