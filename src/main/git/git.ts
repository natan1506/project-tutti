import { spawn } from 'node:child_process'

export interface GitOptions { env?: Record<string, string>; input?: string }

/** Roda git sem herdar variáveis GIT_* do ambiente; lança com o stderr em caso de erro. */
export function runGit(cwd: string, args: string[], opts: GitOptions = {}): Promise<string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('GIT_')) env[k] = v
  Object.assign(env, opts.env)
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], { cwd, env })
    let out = '', err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve(out)
      else reject(Object.assign(new Error(`git ${args[0]} falhou: ${err.trim()}`), { stderr: err }))
    })
    child.stdin.end(opts.input ?? '')
  })
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    return (await runGit(dir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch {
    return false
  }
}

export async function initRepo(dir: string): Promise<void> {
  await runGit(dir, ['init', '-q'])
}
