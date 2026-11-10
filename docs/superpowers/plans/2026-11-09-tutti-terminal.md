# Tutti no terminal — entrega 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a primeira versão útil do terminal. O Natan digita `tutti` dentro de um repositório e o terminal faz três coisas:
- abre a tela;
- mostra o placar de uso no topo;
- roda a esteira padrão Claude → Codex → Antigravity → Claude, compartilhando banco, perfis e histórico com o app.

**Architecture:** O processo principal do app é dividido em dois:
- **Núcleo (`createCore`):** sem Electron, usado pelo app e pelo terminal.
- **Esteira:** um modo novo do `TeamService`, ativado quando o perfil tem `esteira`.

O terminal é uma casca Ink (React para terminal). Ela roda com o Node do Electron (`ELECTRON_RUN_AS_NODE`) e abre o mesmo `time.db`. Dois processos no mesmo banco exigem duas coisas:
- uma trava de projeto entre processos;
- uma recuperação que só mexe nos pedidos do próprio processo.

**Tech Stack:** Electron 45, electron-vite, TypeScript, React 19, Ink 6 (novo), `node:sqlite`, zod, vitest, `@openai/codex-sdk`, `agy` CLI.

**Spec:** `docs/superpowers/specs/2026-11-09-tutti-terminal-design.md`

**Fora desta entrega (plano 2):**
- troca de agente pelo histórico (notas por tipo de tarefa);
- limiar de "poupar o cérebro";
- edição completa no `/agents` (criar, remover, trocar IA) e as travas no `/config`;
- tela detalhada do `/usage`.

Nesta entrega:
- a troca acontece só por **disponibilidade** (fora do ar, sem login ou esgotado), da executor ou tester para a reserva;
- `/agents` lista;
- `/config` muda os papéis da esteira, a autonomia e as voltas.

## Global Constraints

- Chaves de API nunca em arquivo do projeto, log, banco em texto puro ou env de agentes CLI. O terminal não lê chaves: o `KeyStore` dele tem `isAvailable: () => false`.
- Nada de API cobrada por uso no caminho padrão. Agentes por API ficam indisponíveis no terminal nesta entrega e aparecem com `—` no placar.
- Codex e Antigravity escrevem **só dentro da esteira** (`write: true`). Fora dela continuam só-leitura (`sandboxMode: 'read-only'`, `--mode plan`).
- Na esteira, Codex escreve com `sandboxMode: 'workspace-write'` e `networkAccessEnabled: false` (rede liberada depois, em 2026-11-10, decisão do Natan).
- Pasta sem git funciona: sem ponto de restauração, sem diff, sem `/undo`.
- Banco: `~/Library/Application Support/Tutti/time.db`, o mesmo arquivo do app.
- Máquina alvo: Mac Intel (x86_64).
- Textos da interface em português do Brasil.
- Rode a suíte com o PATH sem duplicatas: `CLEAN=$(echo "$PATH" | tr ':' '\n' | awk '!seen[$0]++' | paste -sd: -); PATH=$CLEAN npx vitest run`.
- Placar:
  - cor verde até 60%, amarelo até 85%, vermelho acima;
  - barra no estilo `██████░░░░`;
  - esgotado mostra `esgotado · <dia>`;
  - estimativa com `~`;
  - sem dado, `—`.
- Esteira: no máximo **2 voltas** do cérebro ao executor por padrão.
- Janela que conta como "cérebro sem limite": **qualquer** janela do Claude em 100%.
- Comandos: `/config /agents /usage /history /new /undo /stop /exit`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push só com o OK do Natan.

## Review Focus

1. **Renomear ou recriar agentes ao salvar um perfil com esteira.** Os ids da esteira têm que seguir o `idMap` do `ProfileService.save`; senão a esteira aponta para agentes que não existem. O teste fica na Task 4.
2. **App e terminal abertos juntos.** Ao abrir, um não pode marcar como "interrompido" o pedido que o outro está rodando, e dois pedidos não podem escrever no mesmo projeto ao mesmo tempo. O teste fica na Task 2.
3. **Cérebro sem limite no meio da esteira.** O time para com a mensagem `Claude sem limite até <quando> — o time parou`, sem chamar o executor. O teste fica na Task 5.
4. **Terminal estreito (80 colunas).** O placar continua numa linha só, com as barras encurtadas, sem quebrar. O teste fica na Task 6.
5. **Papel indisponível sem reserva disponível, ou executor que falha.** Erro claro com o nome do agente, sem seguir para o tester. O teste fica na Task 5.

---

### Task 1: Núcleo sem Electron (`createCore`)

**Files:**
- Create: `src/main/core.ts`
- Modify: `src/main/index.ts` (montar os serviços via `createCore`)
- Test: `tests/main/core.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CoreOptions {
    dataDir: string                                   // pasta do time.db, skill-plugins, skill-work
    crypto: { isAvailable(): boolean; encrypt(s: string): Buffer; decrypt(b: Buffer): string }
    adapters?: Record<ToolKind, AgentAdapter | undefined>  // testes injetam falsos
    browser?: BrowserService                          // só o app passa
    emit(runId: string, ev: RunEvent): void
    onUsage?(s: UsageSnapshot): void
    onProfiles?(ps: Profile[]): void
    onActivity?(n: number): void
  }
  export interface Core { store: Store; profiles: ProfileService; keys: KeyStore; runs: RunService; team: TeamService;
    usage: UsageService; skills: SkillService; tools: ReturnType<typeof cachedDetector>; opencode: OpencodeHost; close(): Promise<void> }
  export async function createCore(o: CoreOptions): Promise<Core>   // já chama runs.recover()
  ```
  O `index.ts` mantém o que é do Electron: janela, voices, update check, `registerIpc`, `before-quit`. Ele passa o `safeStorage` como `crypto` e o browser.

- [ ] **Step 1: Escrever os testes**
  - `tests/main/core.test.ts`, com `vi.mock('electron', () => { throw new Error('electron no núcleo') })` no topo.
  - `it('monta o núcleo sem Electron e roda um pedido direto')`:
    - `createCore` com `dataDir` temporário, `crypto.isAvailable: () => false` e adaptador `claude` falso que emite `done`;
    - `store.upsertProject(dir)`, criar conversa, `runs.start({ agentId: 'forja', … })`, `whenFinished`;
    - `expect(store.listRuns(conv.id)[0].status).toBe('done')`.
  - `it('o banco fica em <dataDir>/time.db')`: `existsSync(join(dataDir, 'time.db'))`.
- [ ] **Step 2: Rodar.** `npx vitest run tests/main/core.test.ts`. Esperado: FAIL, módulo `core` não existe.
- [ ] **Step 3: Implementar `createCore`** movendo a montagem de `index.ts` (linhas da criação do store até `runs.recover()`).
  - Não muda nenhum comportamento.
  - O `pollClaude` continua igual.
  - O `usage.onCross` vai junto.
- [ ] **Step 4: Rodar o teste e a suíte inteira.** Esperado: PASS, sem regressão. Depois `npm run build`: compila.
- [ ] **Step 5: Commit** `refactor: núcleo do app sem Electron (createCore)`

### Task 2: Dois processos no mesmo banco

**Files:**
- Modify: `src/main/store/db.ts` (`PRAGMA busy_timeout=5000`; coluna `owner_pid` em runs; `markInterruptedRuns(isAlive)`; tabela `project_locks`)
- Create: `src/main/runs/projectLock.ts`
- Modify: `src/main/runs/runService.ts` (`waitTurn` pega a trava depois da vez na fila em memória; novo `releaseTurn`; `recover` só mexe em runs de processo morto)
- Modify: `src/main/team/teamService.ts:135` (`runs.queue.release` → `runs.releaseTurn`)
- Test: `tests/main/runs/projectLock.test.ts`, `tests/main/store/db.test.ts` (acrescentar)

**Interfaces:**
- Produces:
  ```ts
  // projectLock.ts — trava em project_locks(path PRIMARY KEY, owner TEXT, pid INTEGER, at INTEGER)
  export function tryLock(db: Store, path: string, owner: string, pid?: number, isAlive?: (pid: number) => boolean): boolean
  export async function waitLock(db: Store, path: string, owner: string, signal: AbortSignal, pollMs?: number): Promise<boolean> // false se abortado
  export function unlock(db: Store, path: string, owner: string): void
  // Store ganha: lockProject(path, owner, pid, isAlive): boolean; unlockProject(path, owner): void
  //              markInterruptedRuns(isAlive?: (pid: number) => boolean): number   (padrão: só pid diferente do atual e morto)
  // RunService ganha: releaseTurn(projectPath: string, runId: string): void   (fila em memória + trava)
  ```
  - **Trava velha:** uma trava cujo `pid` está morto (`process.kill(pid, 0)` lança erro) é tomada.
  - **Aviso de espera:** enquanto espera a trava, o run recebe `{ type: 'queued', position: 1 }` uma vez.

- [ ] **Step 1: Escrever os testes**
  - `tryLock`: o primeiro dono pega e o segundo não; depois de `unlock` o segundo pega; trava de pid morto (`isAlive: () => false`) é tomada.
  - `waitLock`: devolve `false` quando o sinal aborta enquanto espera.
  - `db.test`: `it('recover não marca runs de outro processo vivo')`:
    - criar um run `running` com `owner_pid` = pid vivo de outro processo;
    - `markInterruptedRuns(() => true)` devolve 0 e o run segue `running`;
    - com `() => false`, devolve 1.
  - Dois `RunService` sobre o mesmo arquivo de banco: `it('dois processos no mesmo projeto: o segundo espera o primeiro terminar')`:
    - o segundo `start` só chama o adaptador depois que o primeiro fecha;
    - o segundo recebe `queued`.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar** o descrito nas Interfaces. `createRun` grava `owner_pid = process.pid`. A migração adiciona a coluna com `ALTER TABLE … ADD COLUMN owner_pid INTEGER` se ela não existir.
- [ ] **Step 4: Rodar os testes e a suíte.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: app e terminal no mesmo banco (trava de projeto e recuperação por processo)`

### Task 3: Codex e Antigravity escrevem dentro da esteira

**Files:**
- Modify: `src/main/adapters/types.ts` (`write?: boolean` em `AdapterRunOptions`)
- Modify: `src/main/adapters/codex.ts` (`buildCodexThreadOptions`)
- Modify: `src/main/adapters/antigravity.ts` (`buildAgyArgs`)
- Modify: `src/main/runs/runService.ts` (`StartRunInput.write?: boolean`, repassado ao adaptador só em `startChild`)
- Test: `tests/main/adapters/codex.test.ts`, `tests/main/adapters/antigravity.test.ts` (acrescentar)

**Interfaces:**
- Produces: `AdapterRunOptions.write?: boolean` e `runs.startChild({ …, write: true })`.

- [ ] **Step 1: Spike do Antigravity.** Gasta 1 pedido do Antigravity: peça o OK do Natan antes.
  - Numa pasta temporária, rode `agy -p "crie o arquivo ok.txt aqui e também /tmp/fora-<uuid>.txt" --output-format stream-json --mode auto --sandbox --disable-slash-commands`.
  - Se `ok.txt` existir e `/tmp/fora-…` **não** existir, a cerca vale: siga.
  - Se o arquivo de fora existir, **pare e avise o Natan** (spec §7: "o construtor diz isso antes de liberar"). Não libere a escrita do agy.
  - Registre o resultado no ledger.
- [ ] **Step 2: Escrever os testes**
  - `buildCodexThreadOptions({ …, write: true })` tem `sandboxMode: 'workspace-write'` e `networkAccessEnabled: false`.
  - Sem `write`, tem `sandboxMode: 'read-only'`.
  - Com `mode: 'consult'` e `write: true`, continua `read-only`, porque consulta nunca escreve.
  - `buildAgyArgs({ …, write: true })` contém `'--mode', 'auto'` e `'--sandbox'`, e não contém `'plan'`.
  - Sem `write`, contém `'--mode', 'plan'`.
  - Com `consult`, contém `plan`.
- [ ] **Step 3: Rodar.** Esperado: FAIL.
- [ ] **Step 4: Implementar.** Atualizar o comentário do topo dos dois adaptadores: "só-leitura, exceto na esteira (`write`)".
- [ ] **Step 5: Rodar os testes e a suíte.** Esperado: PASS.
- [ ] **Step 6: Commit** `feat: executor e tester escrevem dentro da esteira, com cerca na pasta`

### Task 4: Perfil com esteira e o perfil "Trabalho"

**Files:**
- Modify: `src/shared/profiles.ts` (tipo, esquema zod, `TRABALHO_SEED`)
- Modify: `src/main/profiles/profileService.ts` (`save` remapeia a esteira; `seedTrabalho()`)
- Modify: `src/main/core.ts` (chama `profiles.seedTrabalho()` uma vez)
- Test: `tests/shared/profiles.test.ts`, `tests/main/profiles/profileService.test.ts` (acrescentar)

**Interfaces:**
- Produces:
  ```ts
  export type EsteiraRole = 'cerebro' | 'executor' | 'tester' | 'reserva'
  export interface Esteira { cerebro: string; executor: string; tester: string; reserva?: string; maxVoltas: number }  // ids de agentes do perfil
  // Profile ganha: esteira?: Esteira
  export const DEFAULT_MAX_VOLTAS = 2
  export const TRABALHO_SEED: Profile   // nome 'Trabalho', builtin: false
  // ProfileService ganha: seedTrabalho(): Profile | undefined   (cria uma vez; setting 'seed:trabalho'; não recria se o Natan apagar)
  ```
  Agentes do `TRABALHO_SEED`:
  - **Bússola:** cli claude, `claude-opus-5-5`, cérebro, `readOnly: false`. É também o `coordinatorId`.
  - **Forja:** cli codex, executor, `readOnly: false`. Prompt: implementa exatamente a tarefa recebida e roda os testes do que mexeu.
  - **Radar:** cli gemini (agy), tester, `readOnly: false`. Prompt: valida a tarefa contra o critério de pronto, roda os testes e, quando fizer sentido, usa o navegador; não corrige código, só relata.
  - **Curinga:** cli opencode, `opencode/big-pickle`, reserva.

  Validação: os ids da esteira têm que existir no perfil, e o cérebro não pode ser o mesmo agente que o executor ou o tester. Mensagem de erro: `A esteira aponta para um agente que não está no perfil.`

- [ ] **Step 1: Escrever os testes**
  - `validateProfile` aceita o `TRABALHO_SEED`.
  - `validateProfile` recusa esteira com id inexistente e devolve a mensagem acima.
  - `save` de um perfil novo com esteira: os ids da esteira apontam para os agentes **remapeados** (`a_…`). Esse teste cobre o item 1 do Review Focus.
  - `seedTrabalho` duas vezes cria um perfil só; depois de apagar o perfil, ele não volta.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar os testes e a suíte.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: perfil com esteira e perfil Trabalho`

### Task 5: A esteira no TeamService

**Files:**
- Modify: `src/main/team/brain.ts` (métodos `plan`, `review` e esquemas)
- Modify: `src/main/team/textBrain.ts` (os mesmos dois métodos)
- Modify: `src/main/team/prompts.ts` (`esteiraPlanPrompt`, `executorPrompt`, `testerPrompt`, `reviewPrompt`)
- Create: `src/main/team/esteira.ts`
- Modify: `src/main/team/teamService.ts` (`lifecycle` chama `runEsteira` quando `profile.esteira`; o resto não muda)
- Modify: `src/shared/events.ts` (eventos novos)
- Test: `tests/main/team/esteira.test.ts`

**Interfaces:**
- Consumes:
  - `Profile.esteira` (Task 4);
  - `runs.startChild({ write: true })` (Task 3);
  - `store.latestLimits()`;
  - `runs.availability`.
- Produces:
  ```ts
  // Brain ganha:
  plan(i: { cwd; prompt; signal; onUsage?; feedback?: string }): Promise<unknown>   // → { tarefa: string; pronto: string }
  review(i: { cwd; prompt; plan: EsteiraPlan; executor: string; tester: string; signal; onUsage? }): Promise<unknown> // → { pronto: boolean; falta: string }
  export interface EsteiraPlan { tarefa: string; pronto: string }
  // eventos (RunEvent):
  | { type: 'esteira_plan'; plan: EsteiraPlan; volta: number }
  | { type: 'esteira_swap'; role: EsteiraRole; from: AgentId; to: AgentId; reason: string }
  | { type: 'esteira_review'; pronto: boolean; falta: string; volta: number }
  // esteira.ts:
  export async function runEsteira(ctx: { parentId; input: TeamStartInput; profile: Profile; signal: AbortSignal; active: Set<string>;
    runs: RunService; store: Store; brain: Brain; say(ev: RunEvent): void; autonomy: AutonomyLevel; waitPlan(): Promise<boolean>; settle(id: string): Promise<string> }): Promise<RunStatus>
  export function brainOut(limits: LimitWindow[], tool: ToolKind, now: number): { out: false } | { out: true; until?: number }
  export function pickForRole(role: 'executor' | 'tester', esteira: Esteira, ready: (id: string) => boolean): { id: string; swappedFrom?: string } | null
  ```
  Algoritmo do `runEsteira`, que o construtor segue:
  1. Se `brainOut(...)` → `say` a mensagem `<IA> sem limite até <dia hora> — o time parou` e encerra com status `error`. A mesma checagem vem antes de cada `review`.
  2. `plan` (com `parseEsteiraPlan`, uma nova tentativa se inválido) → `esteira_plan`.
  3. Se `autonomy !== 'autonomous'` → `waitPlan()`. Recusado: encerra com `Plano recusado; nada foi alterado.`, status `cancelled`.
  4. Executor via `pickForRole`.
     - Troca: emite `esteira_swap` com `reason` `<nome> indisponível: <hint>`.
     - `null`: erro `Ninguém disponível para executar: <nome> e <reserva> estão indisponíveis.`, status `error`.
     - `startChild({ write: true, prompt: executorPrompt(plan, feedback) })` → `settle`.
     - Status `error` ou `cancelled`: encerra como no `orchestrate` (`Parei porque o <nome> falhou.`).
  5. Tester: mesma coisa, com `testerPrompt(plan, textoDoExecutor)`. O texto de cada filho é a concatenação dos eventos `text` do run.
  6. `review` → `esteira_review`.
     - `pronto`: `done`.
     - Senão, `volta++`. Se `volta > maxVoltas`: `say` texto `Parei depois de <maxVoltas> voltas. Falta: <falta>` e status `error`.
     - Senão, volta ao passo 4 com `feedback = falta`.

- [ ] **Step 1: Escrever os testes**, com o mesmo `Fake` e `setup` de `teamService.test.ts`, o perfil `TRABALHO_SEED` registrado e um brain falso com `plan` e `review` roteirizados.
  - `it('caminho feliz: plano → executor → tester → revisão pronta')`:
    - eventos do pai em ordem: `esteira_plan`, `child_started`(Forja), `child_started`(Radar), `esteira_review`{pronto:true}, `diff`, `run_finished`{done};
    - o executor recebeu `write: true`.
  - `it('revisão pede mais: volta ao executor com o que falta')`:
    - review devolve `{pronto:false, falta:'X'}` e depois `{pronto:true}`;
    - o segundo prompt do executor contém `X`.
  - `it('passa de 2 voltas: para e diz o que falta')`: status `error`; texto `Parei depois de 2 voltas. Falta: X`.
  - `it('executor indisponível: reserva assume e avisa')`: `esteira_swap` {role:'executor', to: curinga}.
  - `it('executor e reserva indisponíveis: erro claro, tester não roda')`. Cobre o item 5 do Review Focus.
  - `it('executor falha: não chama o tester')`.
  - `it('cérebro sem limite: para antes de chamar o executor')`:
    - store com limite claude 100% e `resetsAt`;
    - texto contém `sem limite até` e `o time parou`;
    - nenhum filho é criado.

    Cobre o item 3 do Review Focus.
  - `it('autonomia pede aprovação: espera o plano; recusado não chama ninguém')`.
  - `it('pasta sem git: esteira roda sem diff')`.
  - `it('perfil sem esteira continua com triagem')`: o caminho atual não muda.
  - Testes puros de `brainOut` e `pickForRole`.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar.**
  - Esquemas JSON:
    - `PLAN_SCHEMA = obj({ tarefa: string, pronto: string })`;
    - `REVIEW_SCHEMA = obj({ pronto: boolean, falta: string })`.
  - Prompts em português, curtos:
    - o do cérebro pede "exatamente o que fazer, arquivos prováveis, critério de pronto verificável";
    - o do tester diz que ele não corrige, só relata.
- [ ] **Step 4: Rodar os testes e a suíte.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: esteira cérebro → executor → tester → cérebro`

### Task 6: Peças puras da tela (placar, linhas da conversa, comandos)

**Files:**
- Create: `src/cli/placar.ts`, `src/cli/lines.ts`, `src/cli/commands.ts`
- Test: `tests/cli/placar.test.ts`, `tests/cli/lines.test.ts`, `tests/cli/commands.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // placar.ts — cores como nomes ('green'|'yellow'|'red'|'gray') para o Ink pintar
  export interface Cell { nome: string; text: string; color: 'green' | 'yellow' | 'red' | 'gray' }
  export function placarCells(agents: { nome: string; tool: UsageSource }[], snap: UsageSnapshot, width: number, now: number): Cell[]
  export function bar(pct: number, size: number): string        // '█' cheio, '░' vazio
  export function colorFor(pct: number | null): Cell['color']   // <=60 green, <=85 yellow, >85 red, null gray
  // lines.ts
  export function eventLine(ev: RunEvent, nomeDe: (id: AgentId) => string): { text: string; color?: string } | null
  // commands.ts
  export type Command = { kind: 'send'; text: string } | { kind: 'new' } | { kind: 'stop' } | { kind: 'exit' } | { kind: 'usage' }
    | { kind: 'history'; index?: number } | { kind: 'undo' } | { kind: 'agents' }
    | { kind: 'config'; key?: 'cerebro' | 'executor' | 'tester' | 'reserva' | 'autonomia' | 'voltas' | 'perfil'; value?: string }
    | { kind: 'unknown'; name: string }
  export function parseCommand(input: string): Command
  ```
  Regras do placar:
  - **Tamanho da barra:** começa em 15 e encolhe até 4 enquanto a linha (`Tutti · <projeto>` mais as células) não couber em `width`.
  - **Abaixo de 4:** os nomes são cortados para 3 letras.
  - **Texto da célula:** `<barra> <pct>%`, ou `~<pct>%` quando estimado.
  - **Esgotado:** pct ≥ 100 mostra `esgotado · <dia abreviado do resetsAt>`, como `seg` ou `ter`.
  - **Sem dado:** `utilization` null mostra `—`, com a barra vazia em cinza.

- [ ] **Step 1: Escrever os testes**
  - `bar(68, 15) === '██████████░░░░░'`.
  - `colorFor(60) === 'green'`, `colorFor(61) === 'yellow'`, `colorFor(86) === 'red'`, `colorFor(null) === 'gray'`.
  - Esgotado com `resetsAt` numa segunda: o texto contém `esgotado · seg`.
  - Estimado: o texto contém `~12%`.
  - Com 4 agentes e `width` 80: o comprimento total da linha é ≤ 80. Cobre o item 4 do Review Focus.
  - Com `width` 200, a barra tem 15.
  - `eventLine`:
    - `esteira_swap` → texto começando com `↪ `, cor amarela;
    - `child_started` → `<Nome>  <tarefa>`;
    - `usage` → null.
  - `parseCommand`:
    - `'/exit'` → `{kind:'exit'}`;
    - `'/config executor Curinga'` → `{kind:'config', key:'executor', value:'Curinga'}`;
    - `'/history 2'` → `{kind:'history', index:2}`;
    - `'oi'` → `send`;
    - `'/xyz'` → `unknown`.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar os testes e a suíte.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat(cli): placar, linhas e comandos do terminal`

### Task 7: A tela do terminal (Ink)

**Files:**
- Create: `src/cli/index.tsx` (entrada), `src/cli/App.tsx`, `src/cli/session.ts` (estado sem React: projeto, conversa, eventos, comandos)
- Modify: `package.json`:
  - dependências `ink@6` e `ink-testing-library` (dev);
  - script `"tutti": "electron-vite build && ELECTRON_RUN_AS_NODE=1 electron out/cli/index.js"`.
- Modify: `electron.vite.config.ts` (entrada `cli` no build `main`, saída `out/cli/index.js`)
- Test: `tests/cli/session.test.ts`, `tests/cli/app.test.tsx`

**Interfaces:**
- Consumes: `createCore` (Task 1), as peças da Task 6 e `team.start`, `runs.respondApproval`, `team.respondPlan`, `runs.answerQuestion`, `runs.cancelAll`, `runs.undo`, `profiles.activeFor/setActive/save`.
- Produces:
  ```ts
  export class Session {
    constructor(core: Core, cwd: string)
    readonly project: Project; conversationId: string
    lines(): { text: string; color?: string }[]
    pending(): { kind: 'approval' | 'plan' | 'question'; id: string; text: string } | null
    async run(cmd: Command): Promise<{ exit?: true; message?: string }>
    answer(value: string): void          // 's'/'n' em aprovação e plano; texto em pergunta
    subscribe(fn: () => void): () => void
  }
  ```
  Comportamento:
  - **Ao abrir:**
    - `upsertProject(cwd)`;
    - retoma a conversa mais recente do projeto ou cria `Terminal`;
    - recarrega os perfis a cada envio, para pegar edições feitas no app;
    - liga o `usage.startPolling()`. É ele que percebe quando o Natan troca a conta do Claude: o placar passa a mostrar a conta nova no próximo ciclo, sem reiniciar.
  - **Texto livre:** vai para `team.start` com o perfil ativo do projeto.
  - **Perfil sem esteira:** a mensagem é `Este projeto usa o perfil <nome>, sem esteira. Use /config perfil Trabalho.`
  - **`/config` sem argumento:** mostra perfil, papéis, autonomia e voltas.
  - **`/config <papel> <nome do agente>`:** salva uma cópia do perfil com a esteira alterada via `profiles.save`.
  - **`/config autonomia <ask_all|accept_edits|autonomous>`:** grava `autonomy:<path>`.
  - **`/config perfil <nome>`:** `setActive`.
  - **`/agents`:** lista nome, IA, modelo, papel e uso.
  - **`/usage`:** `store.tokensByRun(conversationId)` somado por agente, mais o `resetsAt` de cada ferramenta.
  - **`/history`:** lista conversas numeradas; `/history N` retoma a N.
  - **`/undo`:** último run-pai da conversa com `hasCheckpoint`. Sem git, a resposta é `Esta pasta não usa git: não há o que desfazer.`
  - **`/stop`:** `runs.cancelAll()`.
  - **`/exit`:** `core.close()` e sai.
  - **`unknown`:** `Comando desconhecido: /<nome>`.
  - **Tela:** a `App` desenha o placar no topo (`usage.onUsage`, a cada snapshot), as linhas, o pendente (`[s/n]`) e a caixa de texto. O placar usa `process.stdout.columns`.

- [ ] **Step 1: Escrever os testes**
  - `session.test`: `Session` com core de adaptadores falsos e perfil Trabalho ativo.
    - `run({kind:'send'})` produz linhas de esteira.
    - Com autonomia `accept_edits`, `pending()` vira `plan`; `answer('s')` segue.
    - `/undo` em pasta sem git dá a mensagem acima.
    - `/config executor Curinga` muda a esteira salva.
    - `/exit` devolve `{exit:true}`.
  - `app.test` (`ink-testing-library`):
    - o primeiro quadro tem `Tutti ·` e o nome dos 4 agentes na **primeira linha**;
    - digitar `/exit` + Enter chama `exit`.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar.** Instalar `ink` e `ink-testing-library` com versões exatas.
- [ ] **Step 4: Rodar os testes e a suíte.** Esperado: PASS. Depois `npm run build`: gera `out/cli/index.js`.
- [ ] **Step 5: Abrir de verdade sem gastar pedido.** `ELECTRON_RUN_AS_NODE=1 npx electron out/cli/index.js` dentro de uma pasta temporária.
  - O placar aparece.
  - `/agents` lista o time.
  - `/exit` sai.
  - Registre o que viu no ledger.
- [ ] **Step 6: Commit** `feat(cli): tela do Tutti no terminal`

### Task 8: Comando `tutti` instalado pelo app

**Files:**
- Create: `src/main/cliLauncher.ts`
- Modify: `src/main/index.ts` (empacotado: `installLauncher` ao iniciar, silencioso em caso de erro)
- Modify: `electron-builder.yml` (garantir `out/cli/**` dentro do pacote)
- Test: `tests/main/cliLauncher.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function launcherScript(exePath: string, entryPath: string): string
  // '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "<exe>" "<entry>" "$@"\n'
  export function installLauncher(o: { exePath: string; entryPath: string; binDir: string; fs?: {...} }): 'installed' | 'updated' | 'unchanged'
  ```
  - **Onde:** `binDir = ~/.local/bin`, arquivo `tutti`, modo 755.
  - **Conteúdo diferente:** reescreve.
  - **Pasta que não existe:** cria.
  - **`~/.local/bin` fora do PATH:** o app não mexe no shell do Natan. Isso fica no aviso da release.

- [ ] **Step 1: Escrever os testes**
  - `launcherScript` com caminho com espaço (`/Applications/Tutti.app/Contents/MacOS/Tutti`) sai entre aspas.
  - `installLauncher` em pasta temporária: a primeira vez dá `installed`; a segunda, `unchanged`; com outro `exePath`, `updated`.
  - O arquivo fica com permissão de execução.
- [ ] **Step 2: Rodar.** Esperado: FAIL.
- [ ] **Step 3: Implementar.**
  - `exePath = process.execPath`.
  - `entryPath = join(process.resourcesPath, 'app.asar', 'out/cli/index.js')`.
- [ ] **Step 4: Rodar os testes e a suíte.** Esperado: PASS.
- [ ] **Step 5: Verificar no pacote.**
  - `npm run package`.
  - Instalar o `.app` do x64 com `npm run install-app`.
  - Abrir o app uma vez.
  - Rodar `~/.local/bin/tutti` numa pasta temporária: o placar aparece e `/exit` sai.
- [ ] **Step 6: Commit** `feat: comando tutti instalado pelo app`

### Task 9: Teste real da esteira (gasta pedidos — só com o OK do Natan)

- [ ] **Step 1: Pedir o OK.** O teste gasta 1 ciclo da esteira: Claude 2×, Codex 1× e Antigravity 1×, tudo por assinatura e sem API paga.
- [ ] **Step 2: Rodar o pedido.** Numa pasta temporária com git e um `package.json` com teste simples, rode `npm run tutti` e peça "crie soma(a,b) em soma.js com teste".
- [ ] **Step 3: Conferir a tela.** O placar mexe, aparecem as 4 etapas, o arquivo existe e o teste passa.
- [ ] **Step 4: Conferir os efeitos.**
  - `/usage` mostra o gasto por agente.
  - `/undo` desfaz.
  - O app aberto mostra a conversa no histórico.
- [ ] **Step 5: Anotar e commitar.** Registre o resultado no ledger e no spec (§3, "Verificado em …"). Commit `docs: esteira verificada de ponta a ponta`.
