import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_AUTONOMY, isAutonomyLevel } from '@shared/autonomy'
import { agentsOfProfile, getAgent, type ToolKind } from '@shared/agents'
import type { RunEvent } from '@shared/events'
import { isPaidApi, PADRAO, type Profile } from '@shared/profiles'
import type { UsageSnapshot } from '@shared/usage'
import { AntigravityAdapter } from './adapters/antigravity'
import { ClaudeAdapter, pollClaudeUsage } from './adapters/claude'
import { CodexAdapter } from './adapters/codex'
import { OpencodeAdapter, OpencodeHost, startOpencodeServer } from './adapters/opencode'
import type { AgentAdapter } from './adapters/types'
import type { BrowserService } from './browser/browserService'
import { KeyStore, type KeyCrypto } from './keys/keyStore'
import { ProfileService } from './profiles/profileService'
import { RunService } from './runs/runService'
import { SkillService } from './skills/skillService'
import { openStore, type Store } from './store/db'
import { ClaudeBrain } from './team/brain'
import { TeamService } from './team/teamService'
import { TextBrain } from './team/textBrain'
import { cachedDetector, realExec } from './tools/detect'
import { pickReplacement } from './usage/handoff'
import { UsageService } from './usage/usageService'

// Núcleo do Tutti sem Electron: o app e o terminal montam os mesmos serviços sobre o mesmo banco.

export interface CoreOptions {
  /** Pasta do time.db, skill-plugins e skill-work. */
  dataDir: string
  /** Cifra das chaves de API; o terminal passa uma que não está disponível (não lê chaves). */
  crypto: KeyCrypto
  /** Testes injetam adaptadores falsos. */
  adapters?: Record<ToolKind, AgentAdapter | undefined>
  /** Testes dizem quais ferramentas estão prontas; padrão: detecção real (instalada e logada). */
  toolReady?: (t: ToolKind) => Promise<boolean>
  /** Navegador embutido: só o app passa. */
  browser?: BrowserService
  emit(runId: string, ev: RunEvent): void
  onUsage?(s: UsageSnapshot): void
  onProfiles?(ps: Profile[]): void
  onActivity?(n: number): void
}

export interface Core {
  store: Store
  profiles: ProfileService
  keys: KeyStore
  runs: RunService
  team: TeamService
  usage: UsageService
  skills: SkillService
  tools: ReturnType<typeof cachedDetector>
  opencode: OpencodeHost
  close(): Promise<void>
}

export async function createCore(o: CoreOptions): Promise<Core> {
  mkdirSync(o.dataDir, { recursive: true })
  const store = openStore(join(o.dataDir, 'time.db'))
  const profiles = new ProfileService({ store, emit: ps => o.onProfiles?.(ps) })
  const keys = new KeyStore({ store, crypto: o.crypto })
  const tools = cachedDetector(realExec)
  // Spec custos-e-perfis §8: as chaves vão só para o processo do opencode.
  const opencode = new OpencodeHost(() => startOpencodeServer(undefined, keys.all()))
  const adapters = o.adapters ?? { claude: new ClaudeAdapter(), codex: new CodexAdapter(), gemini: new AntigravityAdapter(), opencode: new OpencodeAdapter(opencode) }
  const toolReady = o.toolReady ?? (async (t: ToolKind) => { const s = (await tools())[t]; return s.installed && s.loggedIn })
  const usage = new UsageService({ store, emit: s => o.onUsage?.(s), pollClaude: async () => ((await toolReady('claude')) ? pollClaudeUsage() : []) })
  const runs = new RunService({
    store,
    ...(o.browser ? { browser: o.browser } : {}),
    adapters,
    emit: o.emit,
    toolReady,
    keyReady: p => keys.get(p) !== undefined,
    onUsage: (runId, agentId, ev) => usage.onEvent(runId, agentId, ev),
    skillsFor: id => skills.skillsFor(id),
    skillPluginDir: id => join(o.dataDir, 'skill-plugins', id),
    autonomyFor: p => { const v = store.getSetting(`autonomy:${p}`); return isAutonomyLevel(v) ? v : DEFAULT_AUTONOMY },
    // O sandbox do Agent SDK no macOS usa o sandbox-exec do sistema (spike-sandbox).
    sandboxAvailable: () => process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec'),
    onActivity: n => o.onActivity?.(n),
  })
  // Skills (plano skills): quem cria roda numa pasta vazia do app, em consulta.
  const skillWork = join(o.dataDir, 'skill-work')
  mkdirSync(skillWork, { recursive: true })
  const skills = new SkillService({ store, runs, workDir: skillWork, isPaid: id => isPaidApi(getAgent(id)) })
  // Spec custos-e-perfis §5: ferramenta passou do limite → aviso nos runs dela, com substituto sugerido.
  usage.onCross((tool, _row, window, utilization) => {
    void runs.warnLimit(tool, window, utilization, async from => {
      const ready = await Promise.all(agentsOfProfile(getAgent(from).profileId).map(async a => ((await runs.availability(a.id)).ok ? a.id : null)))
      return pickReplacement(from, ready.filter((x): x is NonNullable<typeof x> => !!x), usage.snapshot(), t => usage.alertAt(t))
    })
  })
  const claudeBrain = new ClaudeBrain()
  const team = new TeamService({
    runs, store, brain: claudeBrain, adapters, toolReady, emit: o.emit,
    profileOf: id => (id && profiles.get(id)) || PADRAO,
    // Coordenador Claude por CLI usa a saída estruturada; qualquer outro responde JSON em texto.
    brainFor: c => (c.transport.kind === 'cli' && c.tool === 'claude' ? claudeBrain : new TextBrain(adapters[c.tool]!, c)),
  })
  await runs.recover()
  return {
    store, profiles, keys, runs, team, usage, skills, tools, opencode,
    async close() {
      runs.cancelAll()
      // Os pedidos cancelados ainda gravam o fim no banco: espera (até ~5 s) antes de fechar.
      for (let i = 0; i < 50 && runs.activeCount() > 0; i++) await new Promise(r => setTimeout(r, 100))
      await opencode.close()
      store.close()
    },
  }
}
