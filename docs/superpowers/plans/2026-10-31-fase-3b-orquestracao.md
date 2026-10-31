# Tutti — Fase 3B: Orquestração — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A aba **Time** funciona: Natan escreve um pedido uma vez; o Bússola faz a triagem (nota e frase de cada agente), os 2–3 candidatos confirmam de verdade na própria ferramenta, o Bússola fecha a escalação (quem faz o quê, com qual modelo, em quais arquivos), pede aprovação do plano quando o pedido é grande, e os agentes trabalham em sequência ou em paralelo (só quando as áreas de arquivo não se cruzam). Um segundo pedido no mesmo projeto entra na fila. No meio do trabalho, Forja, Pincel e Bússola podem perguntar algo ao Radar ou ao Lupa.

**Architecture:** Um pedido de time é um **run-pai** (agente `bussola`, com o ponto de restauração do pedido inteiro e o diff final) e vários **runs-filhos** (um por passo da escalação, sem ponto próprio). Um `TeamService` novo orquestra; o `RunService` da Fase 1 ganha filhos e a trava/fila por projeto. Toda decisão que dá para testar sem modelo é pura: validação do que o Bússola devolve, montagem das ondas (sequência/paralelo), "pedido grande". O Bússola fala por uma interface `Brain` com saída JSON validada por esquema (Claude Agent SDK `outputFormat: json_schema`).

**Tech Stack:** o que já existe; Claude Agent SDK 0.3.314 (`outputFormat`, `createSdkMcpServer`, `tool`).

**Spec:** `docs/superpowers/specs/2026-10-30-time-de-agentes-design.md` — §5.1 (entrada, aba Time, "rodada completa", forçar plano), §5.2 (triagem → confirmação real → escalação final), §5.3 (plano em pedido grande), §5.4 (execução, chamadas entre agentes só para Radar/Lupa), §6.2 (paralelo só com áreas disjuntas; um pedido por vez por projeto; fila), §9 (painel: rodada com barras, mensagem do Bússola com chips).

## Global Constraints

- **Economia de limite (spec §2 anti-objetivo):** triagem = **1** chamada do Bússola (`claude-sonnet-5-5`); confirmação = só os candidatos, em paralelo, modelo barato (`claude-haiku-5-5` nos agentes Claude; padrão da ferramenta nos demais); escalação final = **1** chamada do Bússola. "Rodada completa" (toggle) consulta os seis.
- **Triagem, confirmação e escalação nunca mexem em arquivos:** rodam em modo **consulta** (só leitura em todos os adaptadores).
- **Paralelo só com áreas disjuntas** (spec §6.2): dois passos que escrevem só rodam juntos se as áreas declaradas não se cruzam; área vazia ou desconhecida = sequência. Radar e Lupa (só leitura) podem rodar em paralelo com qualquer um.
- **Pedido grande** (spec §5.3) = o Bússola marcou `big`, **ou** a escalação toca mais de 3 áreas, **ou** alguma área é estrutural (`package.json`, lockfiles, `tsconfig*`, `*.config.*`, `.env*`, pastas `migrations/`/`prisma/`, `Dockerfile`), **ou** Natan ligou "forçar plano". Grande → espera aprovação; recusado → nada é tocado.
- **Um pedido por vez por projeto;** o segundo entra na **fila** (não mais `PROJECT_BUSY`) e começa sozinho quando o primeiro termina; dá para tirar da fila.
- Chamadas no meio do trabalho: só para **Radar** e **Lupa**, profundidade 1 (o chamado não chama ninguém), só nos agentes Claude (Forja, Pincel, Bússola) nesta fase.
- Textos em PT-BR; frases dos agentes curtas (≤ 80 caracteres).

## Review Focus

1. **Bússola devolve algo inválido** (JSON quebrado, agente que não existe, escalação vazia, modelo inventado) — tenta de novo **uma** vez; persistindo, o pedido termina com erro claro no chat e nada é tocado. → testes em Task 2 e Task 6.
2. **Candidato que não responde ou cuja ferramenta está indisponível** na confirmação — após 60 s (ou na hora, se indisponível) conta como "passo"; a escalação segue com os demais; se ninguém sobrar, o Bússola diz isso e o pedido termina sem mexer em nada. → Task 6.
3. **Dois agentes que escrevem com áreas que se cruzam ou sem área declarada** — rodam em sequência, nunca juntos. → Task 3.
4. **Cancelar em qualquer fase** (triagem, confirmação, esperando aprovação do plano, no meio de uma onda) — todos os filhos param, o pedido fecha `cancelled`, o diff do que já mudou aparece e a fila anda. → Task 6.
5. **Fila** — segundo pedido enquanto o primeiro roda fica "na fila (1)"; começa sozinho; tirar da fila remove sem efeito colateral; fechar o app com fila não deixa nada pela metade. → Task 5.

---

## File Structure

```
scripts/spike/brain.mjs                  spike: outputFormat json_schema + ferramenta in-process
docs/superpowers/spike-fase-3b.md
src/shared/team.ts                       tipos: TriageScore, Confirmation, TeamStep, Lineup, TeamEvent
src/shared/events.ts                     + eventos do time (ver Task 2)
src/main/team/parse.ts                   validação/normalização do que o Bússola e os candidatos devolvem
src/main/team/schedule.ts                ondas (sequência/paralelo), áreas, pedido grande
src/main/team/prompts.ts                 textos de triagem, confirmação e escalação (PT-BR)
src/main/team/brain.ts                   interface Brain + ClaudeBrain (JSON por esquema)
src/main/team/teamService.ts             o orquestrador
src/main/team/agentCalls.ts              ferramenta "perguntar_ao_time" (MCP in-process) + limites
src/main/adapters/*.ts                   + modo consulta (só leitura)
src/main/runs/runService.ts              + runs-filhos, ProjectQueue
src/main/store/db.ts                     + parent_run_id (a fila fica em memória)
src/renderer/state/chat.ts               + bloco de time (rodada, escalação, plano, filhos, fila)
src/renderer/components/TeamRound.tsx · LineupCard.tsx · PlanCard.tsx
src/renderer/components/Composer.tsx     aba Time, "rodada completa", "forçar plano"
src/renderer/stage/derive.ts             poses do time (triagem, confirmação, espera do plano)
```

---

### Task 1: Spike — JSON por esquema e ferramenta própria no Claude SDK

Sem TDD. **Files:** `scripts/spike/brain.mjs`, `docs/superpowers/spike-fase-3b.md`.

- [ ] **Step 1:** `brain.mjs` chama `query()` com as opções do adaptador Claude (Fase 1), `model: 'claude-sonnet-5-5'`, **sem ferramentas** (`disallowedTools` com todas as de escrita/execução, ou `allowedTools: []`), e `outputFormat: { type: 'json_schema', schema }` com um esquema pequeno de triagem (`{ scores: [{ agentId, score, line }], candidates: [string], big: boolean }`). Imprime `result.structured_output`, `subtype` e custo/tempo.
- [ ] **Step 2:** Mesmo script, segunda chamada com `mcpServers: { tutti: createSdkMcpServer({ name: 'tutti', tools: [tool('perguntar_ao_time', 'Pergunta algo ao Radar ou ao Lupa', { agente: z.enum(['radar','lupa']), pergunta: z.string() }, async a => ({ content: [{ type: 'text', text: 'resposta falsa: ' + a.pergunta }] }))] }) }` e `strictMcpConfig: true`, prompt "Use a ferramenta perguntar_ao_time para perguntar ao Radar qual a versão do Node, e me diga a resposta". Confirmar: a ferramenta é chamada (nome com prefixo `mcp__tutti__…`), `canUseTool` recebe a chamada (anotar se precisa liberar explicitamente), a resposta volta ao modelo. Anotar se `zod` precisa ser dependência (e qual versão o SDK espera).
- [ ] **Step 3:** Registrar em `docs/superpowers/spike-fase-3b.md`: formato exato de `structured_output`, falhas possíveis (`error_max_structured_output_retries`), nome final da ferramenta, como liberá-la no `canUseTool`. **Commit** `chore: spike da fase 3B (json por esquema, ferramenta própria)`.

---

### Task 2: Tipos do time e validação do que o Bússola devolve

**Files:** Create `src/shared/team.ts`, `src/main/team/parse.ts`; Modify `src/shared/events.ts`; Test `tests/main/team/parse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared/team.ts
  export interface TriageScore { agentId: AgentId; score: number /* 0–100 */; line: string }
  export interface Triage { scores: TriageScore[]; candidates: AgentId[]; big: boolean }
  export type Decision = 'assumo' | 'assumo_com_ajuda' | 'nao_e_comigo' | 'sem_resposta'
  export interface Confirmation { agentId: AgentId; decision: Decision; line: string; helper?: AgentId; redirect?: AgentId }
  export interface TeamStep { agentId: AgentId; task: string; model?: string; areas: string[] }
  export interface Lineup { steps: TeamStep[]; big: boolean; summary: string }
  // events.ts (RunEvent +=)
  | { type: 'triage'; scores: TriageScore[]; candidates: AgentId[] }
  | { type: 'confirmation'; confirmation: Confirmation }
  | { type: 'lineup'; lineup: Lineup; waves: number[][]; big: boolean }
  | { type: 'plan_request'; id: string } | { type: 'plan_resolved'; id: string; approved: boolean }
  | { type: 'child_started'; runId: string; agentId: AgentId; task: string }
  | { type: 'queued'; position: number }
  | { type: 'agent_call'; from: AgentId; to: AgentId; question: string } | { type: 'agent_call_answer'; from: AgentId; to: AgentId; answer: string }
  // main/team/parse.ts
  export function parseTriage(raw: unknown, available: AgentId[]): Triage | null
  export function parseConfirmation(agentId: AgentId, text: string): Confirmation
  export function parseLineup(raw: unknown, available: AgentId[], allowedModels: Record<ToolKind, string[]>): Lineup | null
  export function extractJson(text: string): unknown   // primeiro objeto JSON no texto (bloco ```json ou chaves balanceadas)
  ```
- Regras: `parseTriage` descarta agentes desconhecidos ou indisponíveis, limita `score` a 0–100 (inteiro), corta `line` em 80 caracteres, preenche com `score 0` e `line ''` quem faltou, `candidates` = só disponíveis, sem repetição, no máximo 3 (se vazio, os 2 de maior nota com score ≥ 40); devolve `null` se não houver nenhuma nota válida. `parseConfirmation` aceita JSON (`{decision, line, helper?, redirect?}`) **ou** texto livre: começa com "assumo" → `assumo`; contém "não é comigo"/"nao e comigo" → `nao_e_comigo`; senão `sem_resposta`. `parseLineup` descarta passos de agente desconhecido/indisponível, troca modelo fora de `allowedModels[tool]` por `undefined`, normaliza áreas (sem `./`, sem barra final, sem duplicatas), `task` obrigatória; `null` se sobrar zero passos.

- [ ] **Step 1: Testes que falham** — um `it` por regra acima, inclusive: **Review Focus 1** (JSON quebrado → `extractJson` lança/`null` → `parseTriage(null)` é `null`; agente `'zeus'` descartado; escalação vazia → `null`; modelo `'gpt-99'` vira `undefined`). `extractJson('Aqui:\n```json\n{"a":1}\n```')` → `{a:1}`; `extractJson('texto {"a":{"b":2}} fim')` → `{a:{b:2}}`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5: Commit** `feat: tipos do time e validação das respostas do Bússola`.

---

### Task 3: Ondas, áreas e pedido grande

**Files:** Create `src/main/team/schedule.ts`; Test `tests/main/team/schedule.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function areasOverlap(a: string[], b: string[]): boolean      // prefixo de caminho; '*' ou vazio = sobrepõe tudo
  export function buildWaves(steps: TeamStep[]): number[][]            // índices de `steps` agrupados em ondas
  export function isBig(lineup: Lineup, forced: boolean): boolean
  export const STRUCTURAL: RegExp[]
  ```
- `buildWaves`: percorre os passos em ordem; cada passo entra na **última** onda existente se (a) for só-leitura (`getAgent(id).readOnly`) **e** não houver na onda outro passo do mesmo agente, ou (b) escrever e não se cruzar com nenhum passo que escreve naquela onda **e** a onda não tiver passo do mesmo agente; senão abre onda nova. Revisão (Lupa) sempre fica **depois** dos passos que escrevem que vêm antes dela na lista (nunca na mesma onda que eles). Ordem dos passos dentro da onda = ordem original.

- [ ] **Step 1: Testes que falham:** `areasOverlap(['server'], ['web'])` false; `(['src/a'], ['src'])` true; `([], ['x'])` true; `(['src/app.ts'], ['src/app.tsx'])` false. Ondas: Forja `server/` + Pincel `web/` → `[[0,1]]`; Forja `src/` + Pincel `src/ui` → `[[0],[1]]` (**Review Focus 3**); Pincel sem área → sequência; Radar + Forja → `[[0,1]]`; Forja, Pincel (disjuntos), Lupa → `[[0,1],[2]]`; dois passos do Forja → ondas separadas. `isBig`: `big:true` → true; 4 áreas distintas → true; área `package.json` ou `prisma/schema.prisma` ou `vite.config.ts` → true; 2 áreas comuns → false; `forced` → true.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5: Commit** `feat: ondas de execução e regra de pedido grande`.

---

### Task 4: Modo consulta nos adaptadores

**Files:** Modify `src/main/adapters/{types,claude,codex,antigravity,opencode}.ts`; Test os quatro arquivos de teste de adaptador.

**Interfaces:**
- Produces: `AdapterRunOptions.mode?: 'work' | 'consult'` (padrão `work`). Em `consult`:
  - Claude: `disallowedTools` = `['Write','Edit','MultiEdit','NotebookEdit','Bash','WebFetch','WebSearch','Task']`; `canUseTool` nega qualquer outra que não seja de leitura; sem `mcpServers` extras.
  - Codex: já é `read-only` (sem mudança; teste garante).
  - Antigravity: já é `--mode plan` (teste garante).
  - opencode: sessão criada com `shell`/`edit`/`webfetch`/`external_directory`/`task` = `deny`.
- Uso: confirmação dos candidatos e chamadas do Radar/Lupa no meio do trabalho.

- [ ] **Step 1: Testes que falham:** opções Claude em `consult` contêm cada ferramenta de escrita em `disallowedTools`, e `makeCanUseTool` em `consult` nega `Edit` dentro do projeto e `Bash 'ls'` **sem** chamar `requestApproval`; em `work` nada muda (testes antigos continuam). opencode `consult`: corpo do `createSession` com as cinco regras em `deny`. Codex e agy: opções idênticas nos dois modos.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5: Commit** `feat: modo consulta só leitura em todos os adaptadores`.

---

### Task 5: Runs-filhos, trava e fila por projeto

**Files:** Create `src/main/runs/projectQueue.ts`; Modify `src/main/runs/runService.ts`, `src/main/store/db.ts`, `src/shared/models.ts`; Test `tests/main/runs/projectQueue.test.ts`, `tests/main/runs/runService.test.ts`, `tests/main/store/db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // projectQueue.ts — substitui o Set busyProjects do RunService
  export class ProjectQueue {
    acquire(projectPath: string, id: string, onPosition?: (pos: number) => void): Promise<void>   // resolve quando é a vez; pos 0 = rodando
    release(projectPath: string, id: string): void
    remove(projectPath: string, id: string): boolean   // tira da fila quem ainda não começou
    position(projectPath: string, id: string): number  // -1 = não está
  }
  // RunRow + parentRunId: string | null ; StartRunInput + parentRunId?: string, task?: string, mode?: 'work' | 'consult', model?: string
  // RunService:
  startChild(input: StartRunInput & { parentRunId: string }): Promise<string>   // sem trava, sem ponto de restauração, sem diff próprio
  ```
- `start` (pedido direto, Fase 1) passa a **esperar na fila** em vez de lançar `PROJECT_BUSY`: emite `queued {position}` no run enquanto espera; `cancel` de um run na fila o remove (`run_finished{cancelled}`, sem snapshot). O run-pai do time usa a mesma fila (Task 6). `markInterruptedRuns` vale para filhos também.

- [ ] **Step 1: Testes que falham:** `ProjectQueue`: primeiro `acquire` resolve na hora; segundo espera e recebe `onPosition(1)`; `release` do primeiro libera o segundo (`onPosition(0)`); `remove` do segundo antes da vez → `true` e o terceiro sobe para posição 1; projetos diferentes não se esperam. RunService (**Review Focus 5**): segundo `start` no mesmo projeto emite `queued{position:1}` e só chama o adaptador depois do primeiro terminar; `cancel` do segundo enquanto na fila → `run_finished{cancelled}`, adaptador nunca chamado, sem refs `before`; `startChild` não cria refs nem `diff`, grava `parentRunId`; run que estava na fila quando o app fechou vira `interrupted` no `recover()` sem refs (desfazer indisponível, nada pela metade). Store: `listRuns` traz `parentRunId`; `listChildren(parentId)` em ordem.
- [ ] **Step 2:** FAIL (remover o teste antigo de `PROJECT_BUSY`, substituído). **Step 3:** implementar (migração: `ALTER TABLE runs ADD COLUMN parent_run_id TEXT` se não existir). **Step 4:** PASS. **Step 5: Commit** `feat: runs-filhos e fila por projeto`.

---

### Task 6: TeamService — triagem, confirmação, escalação, plano e ondas

**Files:** Create `src/main/team/prompts.ts`, `src/main/team/brain.ts`, `src/main/team/teamService.ts`; Modify `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/models.ts`; Test `tests/main/team/teamService.test.ts`, `tests/main/team/brain.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5; `RunService`, `AGENTS`, `cachedDetector`.
- Produces:
  ```ts
  // brain.ts
  export interface Brain {
    triage(input: { prompt: string; agents: AgentSummary[]; memory?: string; signal: AbortSignal }): Promise<unknown>
    lineup(input: { prompt: string; triage: Triage; confirmations: Confirmation[]; signal: AbortSignal }): Promise<unknown>
  }
  export class ClaudeBrain implements Brain   // query() com outputFormat json_schema (spike), modelo claude-sonnet-5-5, sem ferramentas
  export const TRIAGE_SCHEMA: object; export const LINEUP_SCHEMA: object
  // teamService.ts
  export interface TeamStartInput { projectPath: string; conversationId: string; prompt: string; fullRound?: boolean; forcePlan?: boolean }
  export class TeamService {
    constructor(deps: { runs: RunService; store: Store; brain: Brain; adapters: Record<ToolKind, AgentAdapter | undefined>; toolReady(t: ToolKind): Promise<boolean>; emit(runId: string, ev: RunEvent): void; confirmTimeoutMs?: number })
    start(input: TeamStartInput): Promise<string>        // id do run-pai
    respondPlan(planId: string, approved: boolean): void
    cancel(parentRunId: string): void
  }
  // TimeApi + startTeam(input): Promise<string>, respondPlan(id, approved): Promise<void>
  ```
- Fluxo do run-pai (todos os eventos gravados nele): entra na fila → snapshot `before` → `triage` (Brain; `parseTriage`; inválido → uma nova tentativa; inválido de novo → `error` "O Bússola não conseguiu organizar o time. Tente de novo ou fale direto com um agente." e fim) → **confirmação** dos `candidates` (ou dos seis, se `fullRound`) em paralelo: cada um via `adapter.run` em `mode:'consult'` com o prompt de confirmação de `prompts.ts`, modelo barato, timeout `confirmTimeoutMs` (60 s); ferramenta indisponível → `sem_resposta` sem chamar; emite `confirmation` por agente na ordem em que chegam (**Review Focus 2**) → se nenhum `assumo*` → `text` do Bússola explicando e fim (`done`) → **escalação** (Brain `lineup` + `parseLineup`; inválido → igual à triagem) → `buildWaves` + `isBig(lineup, forcePlan)` → emite `lineup` → se grande: `plan_request` e espera `respondPlan`; recusado → `plan_resolved{approved:false}`, texto "Plano recusado; nada foi alterado." e fim `cancelled` → **ondas**: para cada onda, `runs.startChild` de cada passo (prompt = tarefa do passo + pedido original + "outros do time nesta onda: …"), emite `child_started`, espera todos; filho com `error` não para a onda corrente, mas a próxima onda não começa (texto "Parei porque o <Agente> falhou.") → snapshot `after`, `diff`, `run_finished`. `cancel` (**Review Focus 4**): aborta Brain/confirmações, resolve plano como recusado, cancela todos os filhos ativos, ainda grava `after`/`diff`, libera a fila.

- [ ] **Step 1: Testes que falham** (Brain falso que devolve objetos roteirizados; adaptadores falsos; repo git temporário; store `:memory:`):
  - caminho feliz: triagem → confirmações (Forja e Pincel `assumo`) → escalação Forja `server/` + Pincel `web/` → uma onda com os dois em paralelo (os dois filhos começam antes de qualquer um terminar) → `diff` com os arquivos dos dois → `run_finished{done}`. Ordem dos tipos de evento do pai: `run_started, triage, confirmation×2, lineup, child_started×2, diff, run_finished`.
  - confirmação usa `mode:'consult'` e o modelo barato; Radar e Curinga **não** são consultados se não forem candidatos; com `fullRound` os seis são.
  - **Review Focus 1:** Brain devolve lixo duas vezes na triagem → `error` com a mensagem acima, nenhum filho, nada no disco; lixo uma vez e válido na segunda → segue.
  - **Review Focus 2:** candidato que nunca responde → após `confirmTimeoutMs` (10 ms no teste) vira `sem_resposta`; candidato com ferramenta indisponível → `sem_resposta` sem chamar o adaptador; todos `nao_e_comigo` → `text` do Bússola + `run_finished{done}` sem filhos.
  - pedido grande: `plan_request`; `respondPlan(id, true)` → executa; `false` → nenhum filho, nada no disco, `run_finished{cancelled}`.
  - **Review Focus 4:** cancelar (a) durante a triagem, (b) esperando o plano, (c) com dois filhos rodando → todos os filhos `cancelled`, pai `cancelled`, `diff` emitido, e um segundo pedido na fila começa em seguida.
  - filho que falha na onda 1 → onda 2 não começa; pai termina `error` com o texto "Parei porque o …".
  - `ClaudeBrain` (brain.test): monta `query` com `outputFormat` e o esquema certo, sem ferramentas; lê `structured_output`; resultado `error_max_structured_output_retries` → lança.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (prompts em `prompts.ts`: triagem lista os agentes com função e média de nota — 0 por ora; confirmação pede JSON `{decision, line, helper?, redirect?}` em uma frase; escalação recebe triagem + confirmações e pede passos com `areas` sempre preenchidas). **Step 4:** PASS. **Step 5: Commit** `feat: orquestração do time (triagem, confirmação, escalação, plano e ondas)`.

---

### Task 7: Chamadas ao Radar e ao Lupa no meio do trabalho

**Files:** Create `src/main/team/agentCalls.ts`; Modify `src/main/adapters/claude.ts`, `src/main/adapters/types.ts`, `src/main/team/teamService.ts`, `src/main/runs/runService.ts`; Test `tests/main/team/agentCalls.test.ts`, `tests/main/adapters/claude.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AskAgent = (to: 'radar' | 'lupa', question: string) => Promise<string>
  export function makeAgentCallTool(ask: AskAgent): McpSdkServerConfigWithInstance   // servidor 'tutti' com a ferramenta 'perguntar_ao_time'
  // AdapterRunOptions + askAgent?: AskAgent   (só Claude usa; mode 'work')
  ```
- `ClaudeAdapter` em `mode:'work'` com `askAgent` adiciona `mcpServers: { tutti: makeAgentCallTool(askAgent) }` (continua `strictMcpConfig: true`) e libera a ferramenta no `canUseTool` (nome do spike). O `askAgent` real (no RunService, quando o run é filho de time ou direto) roda o adaptador do destino em `mode:'consult'`, **sem** `askAgent` (profundidade 1), timeout 120 s, devolve o texto final ("O <Agente> não respondeu a tempo." no timeout; "O <Agente> não está disponível." se a ferramenta não está pronta), e emite `agent_call` / `agent_call_answer` no run de quem perguntou.

- [ ] **Step 1: Testes que falham:** o handler da ferramenta repassa `{agente, pergunta}` ao `ask` e devolve o texto como conteúdo; destino fora de `radar|lupa` é recusado pelo esquema. `buildClaudeOptions` com `askAgent` inclui o servidor `tutti` e mantém `strictMcpConfig`; sem `askAgent`, nenhum servidor. `makeCanUseTool` libera `mcp__tutti__perguntar_ao_time` sem `requestApproval`. RunService: Fake que chama `opts.askAgent('radar', 'qual versão?')` → adaptador do Radar recebe `mode:'consult'` e **sem** `askAgent`; eventos `agent_call` e `agent_call_answer` no run de origem; Radar indisponível → resposta "O Radar não está disponível." sem chamar adaptador.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5: Commit** `feat: agentes perguntam ao Radar e ao Lupa no meio do trabalho`.

---

### Task 8: Interface do time

**Files:** Create `src/renderer/components/{TeamRound,LineupCard,PlanCard}.tsx`; Modify `src/renderer/state/{chat,runStore}.ts`, `src/renderer/components/{Composer,ChatPanel}.tsx`, `src/renderer/stage/derive.ts`, `src/renderer/styles.css`; Test `tests/renderer/runStore.test.ts`, `tests/renderer/stage/derive.test.ts`

**Interfaces / comportamento:**
- `ChatState` ganha, no bloco do run-pai: `triage?`, `confirmations: Confirmation[]`, `lineup?`, `waves?`, `plan?: { id; approved?: boolean }`, `children: string[]` (runIds), `queued?: number`; blocos de filhos têm `parentRunId` e são renderizados **dentro** do bloco do pai.
- Composer: aba **Time** habilitada e selecionada por padrão; com Time ativo, dois toggles discretos: "rodada completa" e "forçar plano"; enviar chama `startTeam`. Aba de agente específico continua indo direto (`startRun`).
- `TeamRound`: "RODADA DE PROPOSTAS" com barra e % por agente (nota da triagem) e a frase — a frase é trocada pela do próprio agente quando a confirmação chega (com marca discreta "confirmou"/"passou"); `LineupCard`: mensagem do Bússola com `summary` e chips "→ Forja", "→ Pincel" na ordem das ondas (paralelos lado a lado); `PlanCard`: lista dos passos (agente, tarefa, áreas) com [Aprovar] [Recusar] enquanto pendente. Fila: nota "Na fila (posição N) — começa quando o pedido atual terminar" com botão "Tirar da fila" (= `cancelRun`).
- Palco (`deriveStage`): enquanto o pai está em triagem, **todos** os agentes disponíveis em `thinking` com balão `dots`; ao chegar a triagem, cada um mostra a própria frase por 4 s (pose `idle`); durante a confirmação, candidatos em `thinking`; plano pendente → Bússola em `waiting` com balão "Aprova o plano?"; filhos seguem as regras da Fase 2.

- [ ] **Step 1: Testes que falham** (reducer e `deriveStage`): `triage` preenche notas; `confirmation` substitui a frase; `lineup` guarda passos/ondas; `plan_request`/`plan_resolved`; `child_started` liga o filho ao pai; `queued`; derive: triagem em andamento → seis disponíveis `thinking`; plano pendente → Bússola `waiting` com o balão; filho trabalhando → pose do filho como na Fase 2.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; `npx tsc -b`; `npm run build`. **Step 5: Commit** `feat: interface do time (rodada, escalação, plano, fila)`.

---

### Task 9: Verificação no app

Script `scripts/e2e/verify-fase3b.mjs` (base: `verify-fase3a.mjs`), pasta descartável resetada antes.

- [ ] **Step 1:** Aba Time: "Crie um endpoint GET /health em server/health.js (Node puro, ESM) e uma página web/status.html que mostre o resultado". Esperado: todos pensando → barras com %; 2–3 candidatos confirmam (frases mudam); escalação com Forja e Pincel; **mesma onda** se áreas disjuntas (registrar se os dois filhos ficaram `working` ao mesmo tempo); arquivos criados; diff do pedido inteiro com os dois.
- [ ] **Step 2: Pedido grande** com "forçar plano": `PlanCard` aparece, Bússola `waiting`; Recusar → nada no disco, pedido `cancelled`.
- [ ] **Step 3: Fila** — enviar um segundo pedido durante o Step 1 (repetir o 1 se necessário): nota "Na fila (posição 1)"; ele começa sozinho depois.
- [ ] **Step 4: Chamada** — aba Forja: "Antes de responder, pergunte ao Radar qual é a versão LTS atual do Node.js e me diga em uma linha." Esperado: eventos `agent_call`/`agent_call_answer` no chat e Radar `working` no palco durante a consulta.
- [ ] **Step 5: Cancelar** um pedido de time com dois filhos rodando → todos param, pedido `cancelled`, próximo da fila (se houver) começa.
- [ ] **Step 6:** Registrar resultados e prints em `docs/superpowers/spike-fase-3b.md` / `docs/superpowers/verificacao-fase-3b/`; anotar quantas chamadas de modelo cada pedido de time gastou; commit `docs: verificação da fase 3B`.
