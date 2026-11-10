import { spawn } from 'node:child_process'
import { safeEnv } from '../adapters/env'

// O critério de pronto conferido pelo próprio Tutti: roda o comando que o cérebro escreveu (ex.: `npm test`) depois do
// tester e guarda o resultado real. O "pronto" não depende só do que a IA diz que rodou.

export interface CheckResult { command: string; ok: boolean; exitCode: number | null; output: string }

const TAIL = 3000

export function runCheck(command: string, cwd: string, signal: AbortSignal, timeoutMs = 10 * 60_000): Promise<CheckResult> {
  return new Promise(resolve => {
    let out = ''
    const child = spawn('/bin/sh', ['-c', command], { cwd, env: { ...safeEnv(), CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    const keep = (d: Buffer) => { out = (out + d.toString()).slice(-TAIL * 2) }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const stop = () => child.kill('SIGTERM')
    const timer = setTimeout(() => { out += `\n[o Tutti parou o comando depois de ${Math.round(timeoutMs / 60_000)} min]`; stop() }, timeoutMs)
    signal.addEventListener('abort', stop, { once: true })
    const done = (exitCode: number | null) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      resolve({ command, ok: exitCode === 0, exitCode, output: out.slice(-TAIL) })
    }
    child.on('error', e => { out += String(e); done(null) })
    child.on('close', code => done(code))
  })
}
