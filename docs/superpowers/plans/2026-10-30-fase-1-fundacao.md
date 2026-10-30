# Time de Agentes — Fase 1: Fundação ponta a ponta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um app Electron em que Natan escolhe uma pasta, manda um pedido direto a um agente (Forja, Pincel ou Bússola via Claude Code; Lupa via Codex só-leitura), acompanha o trabalho no chat, aprova comandos sensíveis e, no fim, vê o diff e pode manter ou desfazer (tudo ou por arquivo).

**Architecture:** Processo principal (Node) concentra tudo que toca disco e CLIs: adaptadores por ferramenta com uma interface comum de eventos, política de comandos, ponto de restauração em git, SQLite. O renderer (React) só recebe eventos por IPC tipado e envia ações. Nada de orquestração multiagente nesta fase — cada pedido vai a um agente só (equivale à "aba de agente específico" da seção 5.1 do spec).

**Tech Stack:** Electron 45 + electron-vite 6, React 19, TypeScript, zustand 5, `@anthropic-ai/claude-agent-sdk` 0.3.314, `@openai/codex-sdk` 0.166.0, `node:sqlite` (fallback `better-sqlite3` 13), git CLI via `child_process` (`execFile`), vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-30-time-de-agentes-design.md`

## Roteiro de fases (cada uma com seu próprio plano, escrito quando a anterior terminar)

1. **Fase 1 — Fundação (este plano):** app, projetos, 1 agente por pedido, aprovações, checkpoint/diff/desfazer, persistência.
2. **Fase 2 — Palco 3D:** mascotes em React Three Fiber (a partir de `docs/mockups/tela-principal.html`), estados, balões, layout final do spec §9.
3. **Fase 3 — Orquestração:** adaptadores Gemini e opencode, triagem/confirmação/escalação (§5.2), plano em pedido grande (§5.3), paralelo e fila (§6.2), chamadas entre agentes (§5.4), testes+correção (§5.5), revisão do Lupa (§5.6), conversa contínua e perguntas (§5.7.1–5.7.2).
4. **Fase 4 — Aprendizado:** memória de projeto, notas, correção de nota, cadernos e consolidação (§8), telas Agentes/Atividade/Projetos (§9).

## Global Constraints

- **Sem API cobrada por uso:** nenhum adaptador lê ou exige `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`; autenticação = login local de cada CLI. Se a variável existir no ambiente, o adaptador a **remove** do `env` do processo filho.
- **Configuração pessoal:** carregar só instruções (`~/.claude/CLAUDE.md`, `<projeto>/CLAUDE.md`, `<projeto>/AGENTS.md`, `~/.codex/AGENTS.md`); **sem** plugins, skills, hooks ou MCP. No Claude SDK: `settingSources: []`, `strictMcpConfig: true`, `mcpServers: {}`, `plugins: []`, instruções via `systemPrompt: { type: 'preset', preset: 'claude_code', append }`.
- **Agentes mexem direto na pasta do projeto**; nunca criar commit/branch/stash visível do Natan nem mexer no index/HEAD dele. Pontos de restauração só em refs próprias `refs/time/…`.
- **Política de comandos (spec §6.4):** liberado = leitura, editar/criar dentro da pasta, comandos de leitura, testes/lint/build; aprovação = instalar pacotes, apagar, `git push/commit/reset/checkout/switch/rebase/merge`, rede, qualquer coisa fora da pasta; desconhecido = aprovação.
- **Electron:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` no renderer; toda API exposta via `contextBridge`.
- **Textos da UI em PT-BR.** Nomes de agentes: Bússola, Forja, Pincel, Radar, Lupa, Curinga (ids sem acento: `bussola`, `forja`, `pincel`, `radar`, `lupa`, `curinga`).
- Gerenciador de pacotes: **npm** (pnpm não está instalado na máquina).
- Node 24 local; TypeScript `strict: true`.

## Review Focus

1. **Pasta com espaço e acento** (ex.: `Meus Projetos/ação`) — checkpoint, diff e desfazer funcionam igual. → teste em Task 5.
2. **Natan edita um arquivo durante o pedido** — desfazer preserva a edição dele quando não se sobrepõe ao trecho do agente e reporta conflito (sem tocar nada) quando se sobrepõe. → testes em Task 5.
3. **Repositório sujo antes do pedido** (mudanças não commitadas + arquivo não rastreado + `node_modules` ignorado) — o diff mostra só o que o agente mudou; HEAD, branch, index e `git status` do Natan ficam idênticos; ignorados ficam fora. → teste em Task 5.
4. **Pedido cancelado com aprovação pendente** — a aprovação se resolve como negada, o pedido termina como `cancelled`, nada fica travado. → teste em Task 9.
5. **App fechado no meio de um pedido** — ao abrir de novo, o pedido aparece como `interrupted` e continua desfazível. → testes em Task 6 e Task 9.

---

## File Structure

```
package.json · electron.vite.config.ts · tsconfig.json · tsconfig.node.json · tsconfig.web.json · vitest.config.ts
scripts/spike/claude.mjs · scripts/spike/codex.mjs · scripts/spike/sqlite-electron.mjs
docs/superpowers/spike-fase-1.md                 resultados do spike (Task 1)
src/shared/agents.ts                             elenco: ids, nomes, ferramenta, função, persona, modelo padrão, readOnly
src/shared/events.ts                             AgentEvent, RunStatus, DiffFile, tipos de IPC
src/main/index.ts                                janela + registro do IPC
src/main/ipc.ts                                  handlers IPC (ponte para RunService/Store/projetos)
src/main/policy/commandPolicy.ts                 classifyToolCall → 'allow' | 'ask'
src/main/instructions/loadInstructions.ts        junta CLAUDE.md/AGENTS.md
src/main/git/git.ts                              runGit (execFile, env isolado)
src/main/git/checkpoint.ts                       snapshot, diff, undo
src/main/store/db.ts                             SQLite: schema + repositórios
src/main/adapters/types.ts                       AgentAdapter + AdapterRunOptions
src/main/adapters/claude.ts                      buildClaudeOptions + mapClaudeMessage + ClaudeAdapter
src/main/adapters/codex.ts                       buildCodexThreadOptions + mapCodexEvent + CodexAdapter
src/main/runs/runService.ts                      ciclo de vida de um pedido
src/preload/index.ts                             window.time (contextBridge)
src/renderer/index.html · src/renderer/main.tsx · src/renderer/App.tsx
src/renderer/state/runStore.ts                   zustand + reducer puro applyEvent
src/renderer/components/{ProjectPicker,Composer,ChatPanel,ApprovalCard,DiffCard,DiffViewer}.tsx
tests/... espelhando src/
```

---

### Task 1: Spike — confirmar assinaturas, aprovação e SQLite no Electron

Risco principal do spec (§7). Sem TDD: scripts descartáveis que respondem sim/não. **Se o item 1 falhar, pare e reporte ao Natan antes de seguir.**

**Files:**
- Create: `package.json` (mínimo: `"type": "module"`, deps exatas da Tech Stack), `scripts/spike/claude.mjs`, `scripts/spike/codex.mjs`, `scripts/spike/sqlite-electron.mjs`, `docs/superpowers/spike-fase-1.md`

- [ ] **Step 1:** `npm init -y` e `npm i @anthropic-ai/claude-agent-sdk@0.3.314 @openai/codex-sdk@0.166.0 && npm i -D electron@45.2.0`. Adicionar `.gitignore` com `node_modules/ out/ dist/ .superpowers/`.
- [ ] **Step 2: `scripts/spike/claude.mjs`** — numa pasta temporária com `git init`, chama `query()` com `prompt: "Rode o comando 'ls' e depois crie hello.txt com 'oi'"`, `cwd`, `model: 'claude-sonnet-5-5'`, as opções da Global Constraints, `permissionMode: 'default'`, `env` sem `ANTHROPIC_API_KEY`, e um `canUseTool` que imprime `toolName` + `input` e devolve `{ behavior: 'allow', updatedInput: input }`. Imprime cada mensagem (`type`/`subtype`) e, no `system/init`, os campos de auth/modelo/ferramentas/MCP/plugins carregados.
- [ ] **Step 3: Rodar** `node scripts/spike/claude.mjs`. Esperado: termina com mensagem `result` de sucesso; `hello.txt` existe; `canUseTool` foi chamado para Bash e Write; o `init` mostra **nenhum** MCP/plugin/skill do usuário e autenticação por assinatura (não API key). Anotar no relatório: quais ferramentas acionaram `canUseTool` (se Read/Glob não acionam, registrar), e o `session_id`.
- [ ] **Step 4: `scripts/spike/codex.mjs`** — `new Codex({ env: <process.env sem OPENAI_API_KEY> })`, `startThread({ workingDirectory, sandboxMode: 'read-only', approvalPolicy: 'never', skipGitRepoCheck: true, model: undefined })`, `runStreamed("Liste os arquivos e diga o que há em hello.txt. Depois tente criar x.txt.")`; imprime cada `ThreadEvent`. Testar também `config: { mcp_servers: {} }` em `CodexOptions` para desligar MCP pessoal.
- [ ] **Step 5: Rodar** `node scripts/spike/codex.mjs`. Esperado: `turn.completed`; `x.txt` **não** existe (sandbox read-only bloqueou); thread id impresso. Anotar formato real de `command_execution`/`file_change`/`agent_message` e se `mcp_servers: {}` foi aceito.
- [ ] **Step 6: `scripts/spike/sqlite-electron.mjs`** — rodado com `npx electron scripts/spike/sqlite-electron.mjs`: `import { DatabaseSync } from 'node:sqlite'`, cria tabela em memória, insere/lê, imprime `process.versions.node` e sai com `app.quit()`. Esperado: imprime a linha lida. Se falhar, a Task 6 usa `better-sqlite3` + `@electron/rebuild` (registrar a decisão).
- [ ] **Step 7:** Escrever `docs/superpowers/spike-fase-1.md` com: sim/não para cada esperado, nomes reais de modelos disponíveis em cada CLI, formato real dos eventos, decisão de SQLite, e qualquer desvio que afete as Tasks 6–8.
- [ ] **Step 8: Commit** `git add -A && git commit -m "chore: spike de assinaturas, aprovação e sqlite"`

---

### Task 2: Scaffold do app + elenco e tipos compartilhados

**Files:**
- Create: `electron.vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`, `src/main/index.ts`, `src/preload/index.ts` (vazio por ora), `src/renderer/{index.html,main.tsx,App.tsx}`, `src/shared/agents.ts`, `src/shared/events.ts`
- Test: `tests/shared/agents.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/shared/agents.ts
  export type AgentId = 'bussola' | 'forja' | 'pincel' | 'radar' | 'lupa' | 'curinga'
  export type ToolKind = 'claude' | 'codex' | 'gemini' | 'opencode'
  export interface AgentDef { id: AgentId; nome: string; tool: ToolKind; funcao: string; persona: string; defaultModel?: string; readOnly: boolean; availableInPhase: 1 | 3 }
  export const AGENTS: readonly AgentDef[]
  export function getAgent(id: AgentId): AgentDef
  // src/shared/events.ts
  export type RunStatus = 'running' | 'done' | 'error' | 'cancelled' | 'interrupted'
  export interface DiffFile { path: string; added: number; removed: number; status: 'A' | 'M' | 'D' }
  export type AgentEvent =
    | { type: 'text'; text: string }
    | { type: 'tool'; name: string; summary: string }
    | { type: 'file_changed'; path: string }
    | { type: 'approval_request'; id: string; toolName: string; summary: string }
    | { type: 'approval_resolved'; id: string; allowed: boolean }
    | { type: 'done'; sessionId?: string }
    | { type: 'error'; message: string }
  export type RunEvent = AgentEvent
    | { type: 'run_started'; runId: string; agentId: AgentId }
    | { type: 'diff'; files: DiffFile[] }
    | { type: 'run_finished'; status: RunStatus }
  ```

- [ ] **Step 1:** Scaffold com electron-vite (template react-ts) **dentro da pasta atual**, versões fixas da Tech Stack; `npm i zustand@5.0.16 react@19.3.1 react-dom@19.3.1 && npm i -D vitest@5.0.5 electron-vite@6.0.0 typescript`. Scripts: `dev`, `build`, `test` (`vitest run`), `typecheck`. `BrowserWindow` com as flags de segurança da Global Constraints, 1280×800, fundo `#0f0d0c`.
- [ ] **Step 2: Teste que falha** — `tests/shared/agents.test.ts`:
  ```ts
  it('elenco do spec §4', () => {
    expect(AGENTS.map(a => [a.id, a.tool])).toEqual([
      ['bussola','claude'],['forja','claude'],['pincel','claude'],['radar','gemini'],['lupa','codex'],['curinga','opencode']])
    expect(getAgent('lupa').readOnly).toBe(true)
    expect(getAgent('radar').readOnly).toBe(true)
    expect(AGENTS.filter(a => a.availableInPhase === 1).map(a => a.id)).toEqual(['bussola','forja','pincel','lupa'])
    expect(getAgent('forja').nome).toBe('Forja'); expect(getAgent('bussola').nome).toBe('Bússola')
  })
  ```
- [ ] **Step 3:** `npm test` → FAIL (módulo não existe).
- [ ] **Step 4:** Implementar `agents.ts` e `events.ts`. `funcao` = coluna "Função" do spec §4; `persona` = 2–3 frases em PT-BR com o papel e "Responda sempre em português do Brasil."; `defaultModel` dos agentes Claude = `'claude-sonnet-5-5'` (Bússola `'claude-opus-5-5'`); Lupa sem `defaultModel` (usa o padrão do Codex).
- [ ] **Step 5:** `npm test` → PASS; `npm run dev` abre janela vazia sem erro no console.
- [ ] **Step 6: Commit** `git commit -am "feat: scaffold electron + elenco e tipos"` (incluir arquivos novos).

---

### Task 3: Política de comandos

**Files:**
- Create: `src/main/policy/commandPolicy.ts`
- Test: `tests/main/policy/commandPolicy.test.ts`

**Interfaces:**
- Produces: `export function classifyToolCall(call: { toolName: string; input: Record<string, unknown> }, projectDir: string): 'allow' | 'ask'` e `export function summarizeToolCall(call): string` (Bash → o comando; Edit/Write/Read → caminho relativo ao projeto; outros → nome da ferramenta).

- [ ] **Step 1: Testes que falham** (`P = '/tmp/proj'`), tabela `it.each`:
  - allow: `Read {file_path:P+'/a.ts'}`, `Glob`, `Grep`, `TodoWrite`, `Edit {file_path:P+'/src/x.ts'}`, `Write {file_path:'src/novo.ts'}` (relativo = dentro), Bash: `ls -la`, `cat a.ts`, `git status`, `git diff HEAD~1`, `git log --oneline`, `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`, `npx vitest run`, `rg foo src`, `ls && git status`.
  - ask: `Read {file_path:'/etc/passwd'}`, `Edit {file_path:'/Users/x/outro/a.ts'}`, `Write {file_path:'../fora.ts'}`, `WebFetch`, `WebSearch`, `FerramentaDesconhecida`, Bash: `npm install zod`, `npm i -D x`, `pnpm add x`, `yarn add x`, `pip install x`, `rm a.ts`, `rm -rf dist`, `git push`, `git commit -m x`, `git reset --hard`, `git checkout main`, `git switch -c x`, `git rebase main`, `git merge x`, `curl https://x`, `wget x`, `ssh host`, `sudo ls`, `cat /etc/hosts`, `ls && rm a`, `ls; curl x`, `echo x | sh`, `find . -delete`, `cd .. && ls`, `node script.js` (desconhecido).
  - `summarizeToolCall({toolName:'Edit', input:{file_path:P+'/src/x.ts'}})` → `'src/x.ts'`; Bash → o comando.
- [ ] **Step 2:** `npx vitest run tests/main/policy` → FAIL.
- [ ] **Step 3: Implementar.** Bash: dividir por `&&`, `||`, `;`, `|` (fora de aspas) e classificar cada segmento; qualquer `ask` → `ask`. Segmento é `allow` só se casar a lista de leitura/teste (comandos `ls cat head tail wc pwd echo grep rg find` sem `-delete`/`-exec`, `git status|diff|log|show|branch` sem argumentos de escrita, `npm|pnpm|yarn (test|run (test|lint|build|typecheck))`, `npx (tsc|vitest|eslint|prettier --check)`) **e** nenhum argumento for caminho absoluto fora de `projectDir` nem `..` que saia dele. Pipe para `sh|bash|zsh` → ask. Caminhos de arquivo: resolver com `path.resolve(projectDir, p)` e checar prefixo `projectDir + path.sep`.
- [ ] **Step 4:** testes → PASS.
- [ ] **Step 5: Commit** `feat: política de comandos (spec §6.4)`.

---

### Task 4: Carregador de instruções

**Files:**
- Create: `src/main/instructions/loadInstructions.ts`
- Test: `tests/main/instructions/loadInstructions.test.ts`

**Interfaces:**
- Produces: `export async function loadInstructions(projectDir: string, homeDir = os.homedir()): Promise<string>`

- [ ] **Step 1: Testes que falham** (pastas temporárias para home e projeto):
  - nenhum arquivo → `''`.
  - com `home/.claude/CLAUDE.md = 'G'`, `proj/CLAUDE.md = 'P'`, `proj/AGENTS.md = 'A'`, `home/.codex/AGENTS.md = 'C'` → resultado contém, nesta ordem, os cabeçalhos `## Instruções globais (CLAUDE.md)`, `## Instruções globais (Codex AGENTS.md)`, `## Instruções do projeto (CLAUDE.md)`, `## Instruções do projeto (AGENTS.md)`, cada um seguido do conteúdo.
  - arquivo vazio/só espaços é ignorado (sem cabeçalho).
- [ ] **Step 2:** FAIL. **Step 3:** implementar (ler com `fs.readFile`, ignorar `ENOENT`). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: carregador de instruções do Natan`.

---

### Task 5: Ponto de restauração, diff e desfazer em git

**Files:**
- Create: `src/main/git/git.ts`, `src/main/git/checkpoint.ts`
- Test: `tests/main/git/checkpoint.test.ts` (helper `makeRepo()` cria pasta temporária com `git init`, `user.name/email` locais, 1 commit inicial)

**Interfaces:**
- Produces:
  ```ts
  export async function runGit(cwd: string, args: string[], env?: Record<string, string>): Promise<string> // execFile('git'), lança com stderr
  export async function isGitRepo(dir: string): Promise<boolean>
  export async function initRepo(dir: string): Promise<void>
  export async function snapshot(dir: string, ref: string): Promise<string>        // grava árvore do working tree (rastreados+não rastreados, respeitando .gitignore) num commit em `ref`; retorna o sha
  export async function diffBetween(dir: string, fromRef: string, toRef: string): Promise<DiffFile[]>
  export async function patchBetween(dir: string, fromRef: string, toRef: string, paths?: string[]): Promise<string>
  export type UndoResult = { ok: true } | { ok: false; conflicts: string[] }
  export async function undo(dir: string, fromRef: string, toRef: string, paths?: string[]): Promise<UndoResult>
  ```
  Refs usadas pelo RunService: `refs/time/runs/<runId>/before` e `refs/time/runs/<runId>/after`.

- [ ] **Step 1: Testes que falham:**
  - `snapshot` não altera nada visível: antes/depois, `git status --porcelain`, `git rev-parse HEAD`, `git branch --show-current` e `git stash list` são idênticos; `git rev-parse refs/time/runs/r1/before` resolve.
  - **Repo sujo (Review Focus 3):** com `a.txt` modificado não commitado, `novo.txt` não rastreado e `node_modules/x.js` ignorado por `.gitignore`: `snapshot(before)`; "agente" altera `b.txt` e cria `c.txt`; `snapshot(after)`; `diffBetween` → exatamente `[{path:'b.txt',status:'M',...},{path:'c.txt',status:'A',...}]` (ordenado por path), sem `a.txt`, `novo.txt`, `node_modules`.
  - `undo` sem paths → `b.txt` volta ao conteúdo de `before`, `c.txt` some, `a.txt` mantém a modificação do Natan.
  - `undo` com `paths:['c.txt']` → só `c.txt` some; `b.txt` continua alterado.
  - **Edição concorrente sem sobreposição (Review Focus 2):** `b.txt` com 20 linhas; agente muda linha 2; Natan muda linha 18 depois do `after`; `undo` → linha 2 volta, linha 18 do Natan permanece.
  - **Edição concorrente com sobreposição:** Natan muda a mesma linha 2 depois do `after`; `undo` → `{ ok:false, conflicts:['b.txt'] }` e **nenhum** arquivo muda (conteúdo idêntico ao de antes da chamada).
  - **Caminho com espaço e acento (Review Focus 1):** repo em `…/Meus Projetos/ação`, arquivo `pasta x/ç.txt` → snapshot, diff (path exato `pasta x/ç.txt`) e undo funcionam.
  - `isGitRepo` false numa pasta sem git; `initRepo` → true e sem commits criados na branch.
- [ ] **Step 2:** `npx vitest run tests/main/git` → FAIL.
- [ ] **Step 3: Implementar.** `runGit` sempre com `-c core.quotepath=false`. `snapshot`: índice temporário (`GIT_INDEX_FILE` = arquivo em `os.tmpdir()`), se houver HEAD fazer `read-tree HEAD` antes, `add -A`, `write-tree`, `commit-tree <tree> -m "time snapshot"` (com `-p HEAD` se existir; autor/committer `Time <time@local>` via env), `update-ref <ref> <sha>`; apagar o índice temporário. `diffBetween`: `diff --numstat -z` + `--name-status -z` entre os refs (binário: added/removed = 0). `undo`: `patchBetween` com `--binary`, depois `git apply -R --check` (patch via stdin); se falhar, extrair os caminhos das mensagens `error: patch failed: <path>:` / `<path>: does not match index`/`already exists` e devolver `conflicts`; se passar, `git apply -R`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: ponto de restauração, diff e desfazer em git`.

---

### Task 6: Persistência (SQLite)

**Files:**
- Create: `src/main/store/db.ts`
- Test: `tests/main/store/db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Project { id: string; path: string; name: string; lastOpenedAt: number }
  export interface Conversation { id: string; projectId: string; title: string; createdAt: number }
  export interface RunRow { id: string; conversationId: string; agentId: AgentId; prompt: string; status: RunStatus; sessionId: string | null; startedAt: number; finishedAt: number | null; hasCheckpoint: boolean }
  export function openStore(file: string /* ':memory:' nos testes */): Store
  export interface Store {
    upsertProject(path: string): Project            // name = basename; atualiza lastOpenedAt
    recentProjects(limit?: number): Project[]       // ordem: lastOpenedAt desc
    createConversation(projectId: string, title: string): Conversation
    listConversations(projectId: string): Conversation[]
    createRun(r: Omit<RunRow, 'status' | 'finishedAt' | 'sessionId'>): RunRow   // status 'running'
    finishRun(id: string, status: RunStatus, sessionId?: string): void
    appendEvent(runId: string, ev: RunEvent): void  // seq crescente por run
    listRuns(conversationId: string): RunRow[]
    listEvents(runId: string): RunEvent[]           // na ordem de seq
    markInterruptedRuns(): number                   // 'running' → 'interrupted'; retorna quantos
  }
  ```
- [ ] **Step 1: Testes que falham:** `upsertProject` duas vezes no mesmo path → 1 projeto, `lastOpenedAt` atualizado; `recentProjects` ordenado; ciclo conversa→run→3 eventos→`listEvents` na ordem; `finishRun` grava status/sessionId/finishedAt; **Review Focus 5:** run deixado `running`, reabrir o store no **mesmo arquivo** (temp) → `markInterruptedRuns()` retorna 1 e o run fica `interrupted` com `hasCheckpoint` preservado.
- [ ] **Step 2:** FAIL. **Step 3:** implementar com o driver decidido no spike (`node:sqlite` `DatabaseSync` ou `better-sqlite3`); ids com `crypto.randomUUID()`; eventos como JSON; `PRAGMA journal_mode=WAL`. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: persistência sqlite`.

---

### Task 7: Adaptador Claude Code

**Files:**
- Create: `src/main/adapters/types.ts`, `src/main/adapters/claude.ts`
- Test: `tests/main/adapters/claude.test.ts`

**Interfaces:**
- Consumes: `classifyToolCall`, `summarizeToolCall` (Task 3); `AgentDef` (Task 2).
- Produces:
  ```ts
  // types.ts
  export interface AdapterRunOptions {
    agent: AgentDef; prompt: string; cwd: string; model?: string; instructions: string
    resumeSessionId?: string; signal: AbortSignal
    requestApproval(req: { toolName: string; summary: string }): Promise<boolean>
  }
  export interface AgentAdapter { run(opts: AdapterRunOptions): AsyncIterable<AgentEvent> }
  // claude.ts
  export function buildClaudeOptions(opts: AdapterRunOptions, canUseTool: CanUseTool): Options
  export function mapClaudeMessage(msg: SDKMessage, cwd: string): AgentEvent[]
  export function makeCanUseTool(opts: AdapterRunOptions): CanUseTool
  export class ClaudeAdapter implements AgentAdapter
  ```
- [ ] **Step 1: Testes que falham:**
  - `buildClaudeOptions` → `settingSources: []`, `strictMcpConfig: true`, `mcpServers: {}`, `plugins: []`, `permissionMode: 'default'`, `cwd`, `model` (opts.model ?? agent.defaultModel), `resume` = resumeSessionId, `systemPrompt.append` contém `agent.persona` **e** `instructions`, `env` sem `ANTHROPIC_API_KEY` (definir no `process.env` do teste e checar ausência).
  - `mapClaudeMessage`: assistant com bloco text → `[{type:'text'}]`; tool_use `Bash {command:'npm test'}` → `[{type:'tool', name:'Bash', summary:'npm test'}]`; tool_use `Edit {file_path: cwd+'/src/a.ts'}` → `tool` + `{type:'file_changed', path:'src/a.ts'}`; result success → `[{type:'done', sessionId}]`; result error → `[{type:'error', message}]`; `system`/outros → `[]`. Fixtures no formato observado no spike.
  - `makeCanUseTool`: `Read` dentro do projeto → `{behavior:'allow', updatedInput:input}` sem chamar `requestApproval`; `Bash 'npm install x'` → chama `requestApproval({toolName:'Bash', summary:'npm install x'})`; true → allow, false → `{behavior:'deny', message:'Natan negou este comando.'}`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar; `ClaudeAdapter.run` = `query({prompt, options})`, repassa `opts.signal` via `abortController`, e `yield*` dos eventos mapeados. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: adaptador Claude Code`.

---

### Task 8: Adaptador Codex (Lupa, só-leitura)

**Files:**
- Create: `src/main/adapters/codex.ts`
- Test: `tests/main/adapters/codex.test.ts`

**Interfaces:**
- Produces: `buildCodexThreadOptions(opts: AdapterRunOptions): ThreadOptions`, `mapCodexEvent(ev: ThreadEvent, cwd: string): AgentEvent[]`, `class CodexAdapter implements AgentAdapter`.

- [ ] **Step 1: Testes que falham:** opções → `sandboxMode:'read-only'`, `approvalPolicy:'never'`, `workingDirectory: cwd`, `skipGitRepoCheck:true`, `model` só se definido; prompt enviado = `persona + '\n\n' + instructions + '\n\n' + prompt` (testar a função que monta). `mapCodexEvent`: `item.completed` agent_message → text; command_execution → tool (summary = comando); file_change → file_changed por arquivo (relativo); `turn.completed` → `done` com o thread id; `turn.failed`/`error` → error; demais → `[]`. Fixtures do spike.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (`resumeThread` quando `resumeSessionId`; `CodexOptions.env` sem `OPENAI_API_KEY`; `config` desligando MCP se o spike confirmou). `requestApproval` nunca é chamado (read-only). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: adaptador Codex só-leitura para o Lupa`.

---

### Task 9: RunService — ciclo de vida de um pedido

**Files:**
- Create: `src/main/runs/runService.ts`
- Test: `tests/main/runs/runService.test.ts` (com `FakeAdapter` que emite uma sequência roteirizada e escreve arquivos no repo; repo temporário real; store `:memory:`)

**Interfaces:**
- Consumes: Tasks 4–8.
- Produces:
  ```ts
  export interface StartRunInput { projectPath: string; conversationId: string; agentId: AgentId; prompt: string }
  export class RunService {
    constructor(deps: { store: Store; adapters: Record<ToolKind, AgentAdapter | undefined>; emit: (runId: string, ev: RunEvent) => void; homeDir?: string })
    start(input: StartRunInput): Promise<string>                  // runId; roda em segundo plano
    respondApproval(approvalId: string, allowed: boolean): void
    cancel(runId: string): void
    undo(runId: string, paths?: string[]): Promise<UndoResult>     // usa refs before/after do run
    recover(): void                                                // chama store.markInterruptedRuns() na inicialização
  }
  ```
- [ ] **Step 1: Testes que falham:**
  - feliz: `start` → eventos emitidos e persistidos em ordem `run_started`, …adaptador…, `diff` (com o arquivo que o Fake escreveu), `run_finished{status:'done'}`; `sessionId` gravado; refs `refs/time/runs/<id>/before|after` existem.
  - pasta sem git → `start` rejeita com `Error('NOT_A_GIT_REPO')` sem criar run (a UI pergunta e chama `initRepo` antes).
  - aprovação: Fake chama `requestApproval` → emite `approval_request{id}`; `respondApproval(id,true)` → Fake recebe `true` e emite-se `approval_resolved{allowed:true}`.
  - **Review Focus 4:** aprovação pendente + `cancel(runId)` → promessa do Fake resolve `false`, `signal.aborted === true`, termina com `run_finished{status:'cancelled'}`, snapshot `after` ainda é gravado e `diff` emitido.
  - adaptador lança → `error` + `run_finished{status:'error'}`, `after`/`diff` ainda gravados.
  - `undo(runId)` reverte o que o Fake escreveu (delegando ao `undo` da Task 5).
  - **Review Focus 5:** run `running` no store + `recover()` → `interrupted`; `undo` desse run funciona se o ref `after` existir; se não existir, retorna `{ ok:false, conflicts: [] }` sem mexer em arquivos (a UI mostra "pedido interrompido antes do fim; desfazer indisponível").
- [ ] **Step 2:** FAIL. **Step 3:** implementar. `start`: `isGitRepo` → `snapshot(before)` → `createRun` → `loadInstructions` → `adapter.run(...)` com `requestApproval` que gera id, emite `approval_request` e aguarda `respondApproval`/abort → cada evento: `appendEvent` + `emit` → no `finally`: `snapshot(after)`, `diffBetween`, emitir `diff` e `run_finished`, `finishRun`. Agente com `availableInPhase === 3` → rejeita `Error('AGENT_NOT_AVAILABLE')`. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: ciclo de vida do pedido`.

---

### Task 10: IPC, preload e interface (sem 3D)

Layout provisório que já segue o spec §9 em estrutura: trilho esquerdo, área central com cabeçalho (título "Time", seletor de projeto) e lista simples dos agentes (nome + ferramenta + pílula de estado; placeholder do palco 3D da Fase 2), campo de pedido com abas por agente, painel direito com o chat. Cores do mockup.

**Files:**
- Create: `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/state/runStore.ts`, componentes listados na File Structure
- Modify: `src/main/index.ts` (instanciar Store em `app.getPath('userData')/time.db`, RunService com `ClaudeAdapter` e `CodexAdapter`, `recover()`, registrar IPC)
- Test: `tests/renderer/runStore.test.ts`

**Interfaces:**
- Produces (preload, `window.time`):
  ```ts
  pickFolder(): Promise<string | null>                 // dialog.showOpenDialog openDirectory+createDirectory
  openProject(path: string): Promise<{ project: Project; isGitRepo: boolean }>
  initGit(path: string): Promise<void>
  recentProjects(): Promise<Project[]>
  newConversation(projectId: string, title: string): Promise<Conversation>
  listConversations(projectId: string): Promise<Conversation[]>
  loadConversation(id: string): Promise<{ runs: RunRow[]; events: Record<string, RunEvent[]> }>
  startRun(input: StartRunInput): Promise<string>
  respondApproval(id: string, allowed: boolean): Promise<void>
  cancelRun(runId: string): Promise<void>
  undo(runId: string, paths?: string[]): Promise<UndoResult>
  onRunEvent(cb: (runId: string, ev: RunEvent) => void): () => void
  ```
  Renderer: `export function applyEvent(state: ChatState, runId: string, ev: RunEvent): ChatState` (puro) e o hook `useRunStore`.

- [ ] **Step 1: Testes que falham** (`applyEvent`): `run_started` cria bloco do run com agente em `trabalhando`; `text` concatena no bloco; `tool` adiciona passo (contagem de passos = nº de `tool`); `approval_request` cria card pendente e agente em `esperando`; `approval_resolved` fecha o card; `diff` guarda arquivos; `run_finished{done}` → agente `concluído`; `{cancelled|error}` → agente `disponível` e mensagem correspondente; eventos de outro `runId` não interferem.
- [ ] **Step 2:** FAIL. **Step 3:** implementar store, IPC (validar `agentId` contra `AGENTS` e paths como string absoluta no main) e componentes:
  - `ProjectPicker`: recentes + "Abrir pasta…"; se `isGitRepo` false → diálogo "Esta pasta não usa git. Posso iniciar um repositório para permitir desfazer?" [Iniciar git] [Cancelar] (spec §6.3: na Fase 1, sem git o pedido não roda).
  - `Composer`: abas Bússola, Forja, Pincel, Lupa ativas; Radar e Curinga desabilitadas com dica "chega na Fase 3"; aba "Time" desabilitada com dica "chega na Fase 3"; Enter envia, Shift+Enter nova linha.
  - `ChatPanel`: mensagem do Natan, texto do agente, card recolhível "<Agente> está trabalhando · N passos" → "<Agente> concluiu em X s" (expande a lista de passos), botão Cancelar enquanto roda.
  - `ApprovalCard`: comando/resumo + [Permitir] [Negar].
  - `DiffCard`: "N arquivos alterados" com +/− por arquivo; [Manter tudo] (só fecha o card), [Ver diff] (abre `DiffViewer` com o patch unificado colorido — IPC extra `patch(runId, path?)` usando `patchBetween`), [Desfazer] e "desfazer" por arquivo; conflito → aviso listando os arquivos e nada é alterado.
- [ ] **Step 4:** `npm test` → PASS; `npm run typecheck` → sem erros.
- [ ] **Step 5: Commit** `feat: interface da fase 1 (chat, aprovações, diff)`.

---

### Task 11: Verificação ponta a ponta no app

Sem código novo, salvo correções. Usar uma pasta de teste descartável `~/Documents/www/projects/time-teste-fase1` com `git init` e um `package.json` mínimo com `"test": "node -e \"process.exit(0)\""`.

- [ ] **Step 1:** `npm run dev`; abrir a pasta de teste.
- [ ] **Step 2:** Aba Forja: "Crie src/soma.js exportando soma(a,b) e rode npm test". Esperado: passos aparecem; `npm test` roda sem pedir aprovação; diff mostra `src/soma.js` (A); [Manter tudo] fecha.
- [ ] **Step 3:** Aba Pincel: "Instale o pacote left-pad". Esperado: card de aprovação para `npm install left-pad`; [Negar] → agente segue/encerra sem instalar; `package.json` inalterado.
- [ ] **Step 4:** Aba Forja: "Altere soma para aceitar 3 números"; durante o trabalho, editar à mão outra linha do arquivo; no fim, [Desfazer]. Esperado: mudança do agente revertida, edição manual preservada.
- [ ] **Step 5:** Aba Lupa: "Revise src/soma.js". Esperado: resposta em PT-BR, nenhum arquivo alterado (diff vazio).
- [ ] **Step 6:** Fechar o app no meio de um pedido; reabrir. Esperado: pedido aparece como interrompido.
- [ ] **Step 7:** Registrar resultado de cada passo (com print) em `docs/superpowers/spike-fase-1.md` (seção "Verificação"); commit `docs: verificação da fase 1`.
