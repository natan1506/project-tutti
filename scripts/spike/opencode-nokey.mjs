// Spike (perfis, Task 1): o opencode lista modelos de um provedor declarado sem chave?
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
for (const cfg of [{}, { provider: { openai: {} } }]) {
  const env = { ...process.env, PATH: `${join(homedir(), '.opencode/bin')}:${process.env.PATH}` }
  for (const k of Object.keys(env)) if (/API_KEY|OPENCODE_/.test(k)) delete env[k]
  const proc = spawn('opencode', ['serve', '--hostname=127.0.0.1', '--port=0'], { env: { ...env, OPENCODE_SERVER_PASSWORD: 'x', OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: {}, plugin: [], ...cfg }), OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'nk-')) } })
  const base = await new Promise(res => { let b = ''; proc.stdout.on('data', d => { b += d; const m = b.match(/listening on (https?:\/\/\S+)/); if (m) res(m[1]) }) })
  const auth = { Authorization: 'Basic ' + Buffer.from('opencode:x').toString('base64') }
  const p = (await (await fetch(base + '/api/provider', { headers: auth })).json()).data.map(x => x.id)
  const m = (await (await fetch(base + '/api/model', { headers: auth })).json()).data
  const by = {}; for (const x of m) by[x.providerID] = (by[x.providerID] ?? 0) + 1
  console.log(JSON.stringify(cfg), 'provedores', p.join(','), 'modelos', JSON.stringify(by))
  proc.kill('SIGTERM')
}
process.exit(0)
