import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@shared/events'
import type { AdapterRunOptions, AgentAdapter } from '../../src/main/adapters/types'
import { createCore } from '../../src/main/core'

// O núcleo roda no terminal sem Electron: qualquer import do Electron quebra este teste.
vi.mock('electron', () => { throw new Error('electron no núcleo') })

const noCrypto = { isAvailable: () => false, encrypt: () => { throw new Error('x') }, decrypt: () => { throw new Error('x') } }

class Done implements AgentAdapter {
  async *run(_o: AdapterRunOptions): AsyncGenerator<AgentEvent> { yield { type: 'done' } }
}

async function core() {
  const dataDir = mkdtempSync(join(tmpdir(), 'core-'))
  const fake = new Done()
  const c = await createCore({
    dataDir, crypto: noCrypto, emit: () => {},
    adapters: { claude: fake, codex: fake, gemini: fake, opencode: fake }, toolReady: async () => true,
  })
  return { c, dataDir }
}

describe('núcleo sem Electron', () => {
  it('monta o núcleo sem Electron e roda um pedido direto', async () => {
    const { c } = await core()
    const dir = mkdtempSync(join(tmpdir(), 'proj-'))
    const conv = c.store.createConversation(c.store.upsertProject(dir).id, 't')
    const id = await c.runs.start({ projectPath: dir, conversationId: conv.id, agentId: 'forja', prompt: 'x' })
    await c.runs.whenFinished(id)
    expect(c.store.listRuns(conv.id)[0].status).toBe('done')
    await c.close()
  })

  it('o banco fica em <dataDir>/time.db', async () => {
    const { c, dataDir } = await core()
    expect(existsSync(join(dataDir, 'time.db'))).toBe(true)
    await c.close()
  })
})
