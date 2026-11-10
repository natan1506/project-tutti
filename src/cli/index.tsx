import { render } from 'ink'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createCore } from '../main/core'
import { App } from './App'
import { Session } from './session'

// Entrada do comando `tutti` (spec tutti-terminal §6): roda com o Node do Electron (ELECTRON_RUN_AS_NODE)
// e abre o mesmo banco do app. Não lê chaves de API: agentes por API ficam indisponíveis aqui.

declare const __TUTTI_VERSION__: string

const noKeys = {
  isAvailable: () => false,
  encrypt: (): Buffer => { throw new Error('KEYCHAIN_UNAVAILABLE') },
  decrypt: (): string => { throw new Error('KEYCHAIN_UNAVAILABLE') },
}

const VERSION = typeof __TUTTI_VERSION__ === 'string' ? __TUTTI_VERSION__ : ''

/** Terminais que falam o protocolo kitty (Shift+Enter diferente de Enter): liga direto, sem esperar a resposta da consulta. */
const KITTY_TERMINALS = new Set(['WarpTerminal', 'iTerm.app', 'ghostty', 'kitty', 'WezTerm'])

async function main() {
  const arg = process.argv[2]
  if (arg === '--version' || arg === '-v') { console.log(`tutti ${VERSION}`); return }
  if (arg === '--help' || arg === '-h') {
    console.log('tutti — time de agentes no terminal.\nAbra dentro de um repositório e escreva o pedido. Dentro, digite / para ver os comandos.\n  tutti --version   mostra a versão')
    return
  }
  const dataDir = process.env.TUTTI_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'Tutti')
  let session: Session | undefined
  const core = await createCore({
    dataDir, crypto: noKeys,
    emit: (runId, ev) => session?.onEvent(runId, ev),
    onUsage: s => session?.onUsage(s),
  })
  session = await Session.open(core, process.cwd(), VERSION)
  const stopPolling = core.usage.startPolling()
  const out = process.stdout
  let ink: ReturnType<typeof render> | undefined
  const close = async () => {
    stopPolling()
    ink?.unmount()
    await core.close()
    process.exit(0)
  }
  const draw = () => <App session={session!} exit={() => void close()} width={out.columns || 100} height={out.rows || 40} />
  // kitty: o terminal que suporta (Warp, iTerm2, Ghostty, kitty) diferencia Shift+Enter de Enter.
  ink = render(draw(), { exitOnCtrlC: false, alternateScreen: true, kittyKeyboard: { mode: KITTY_TERMINALS.has(process.env.TERM_PROGRAM ?? '') ? 'enabled' : 'auto' } })
  out.on('resize', () => ink?.rerender(draw()))
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => void close())
}

void main().catch(e => {
  console.error(`Tutti não abriu: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
