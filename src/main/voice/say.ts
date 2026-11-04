import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Saída de `say -v ?` (lista de vozes do macOS). */
export async function sayVoices(): Promise<string> {
  return (await run('/usr/bin/say', ['-v', '?'])).stdout
}

/** Fala com `say` gravando um WAV; o texto vai por arquivo, nunca como argumento. */
export async function sayToWav(text: string, voice: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'tutti-say-'))
  try {
    const input = join(dir, 'in.txt')
    const out = join(dir, 'out.wav')
    await writeFile(input, text)
    await run('/usr/bin/say', ['-v', voice, '-f', input, '-o', out, '--data-format=LEI16@22050'], { timeout: 30_000 })
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
