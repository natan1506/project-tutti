# Tutti — Fase 3A: Elenco completo e conversa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Os seis agentes funcionando: Radar (Antigravity CLI `agy` do Google, só leitura, pesquisa na web) e Curinga (opencode, com aprovação real de comandos) entram no time; a conversa passa a ter memória (cada agente retoma a própria sessão) e um agente pode parar para fazer uma pergunta em texto livre ao Natan.

**Architecture:** Dois adaptadores novos com a mesma interface `AgentAdapter` da Fase 1. O Radar roda como processo `agy -p … --output-format stream-json --mode plan` por pedido (Antigravity CLI, que o Natan já usa e tem logado; substitui o Gemini CLI do spec); o opencode roda como **um** servidor local (SDK) por app, com uma sessão por agente e pedidos de permissão encaminhados à política de comandos já existente. Um detector de ferramentas diz quais CLIs estão instalados e logados; agente sem CLI fica travado com a instrução de instalação, em vez de "Fase 3".

**Tech Stack:** Antigravity CLI `agy` 1.4.11 (já instalado em `~/.local/bin/agy` e logado), opencode-ai 1.19.5 (CLI) + @opencode-ai/sdk 1.19.5, mais o que já existe.

**Spec:** `docs/superpowers/specs/2026-10-30-time-de-agentes-design.md` — §4 (elenco), §5.4 (execução), §5.7.1 (conversa contínua), §5.7.2 (pergunta ao Natan), §6.4 (aprovação), §7 (adaptadores, configuração só com instruções).

## Roteiro da Fase 3 (um plano por parte, escrito quando a anterior terminar)

- **3A — Elenco completo e conversa (este plano):** Radar, Curinga, detecção de CLIs, conversa contínua, pergunta ao Natan.
- **3B — Orquestração:** aba "Time", triagem do Bússola, confirmação real dos candidatos, escalação, plano aprovado em pedido grande, sequência/paralelo com áreas de arquivo disjuntas, fila por projeto, chamadas a agentes só-leitura no meio do trabalho (spec §5.2–5.4, §6.2).
- **3C — Qualidade:** testes/lint com até 2 correções, revisão do Lupa com atribuição e correção, desfazer limitado às mudanças do agente (decisão pendente do Natan sobre edições feitas durante o pedido), pendências menores das Fases 1–2 (spec §5.5–5.7).

## Global Constraints

- **Sem API cobrada por uso:** Antigravity e opencode rodam pelo login do Natan. O ambiente dos processos filhos remove `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL`. Se o spike mostrar que um CLI só funciona com chave de API, **parar e perguntar ao Natan**.
- **Só instruções, sem plugins/extensões/hooks/MCP** (spec §7): `agy` sem os plugins e sem os servidores MCP do usuário (`~/.gemini/config/mcp_config.json`), via `--settings`/`--disable-slash-commands` conforme o spike; opencode com `mcp: {}` e sem plugins. Instruções do Natan entram pelo `loadInstructions` já existente.
- **Radar é só leitura** (spec §4): nunca escreve arquivo nem roda comando que altere algo; pode pesquisar na web.
- **Curinga segue a política §6.4**: toda permissão pedida pelo opencode passa por `classifyToolCall`; `ask` vira card de aprovação.
- Textos em PT-BR. Nomes: Radar (Antigravity), Curinga (opencode). O `ToolKind` continua `'gemini'` internamente; o rótulo exibido passa a ser `Antigravity`.
- Instalar/logar CLIs é ação do **Natan** (login exige navegador e conta dele). O executor do plano pede e espera.

## Review Focus

1. **CLI não instalado ou deslogado** — mascote fica travado com a pílula `Instale o Antigravity` / `Entre no opencode`, o clique não seleciona, e um pedido enviado mesmo assim (via IPC) volta com erro amigável, sem travar. → testes em Task 2 e Task 3/4.
2. **Cancelar pedido do Radar ou do Curinga** — o processo `agy` morre (sem zumbi) e o servidor do opencode continua aceitando o próximo pedido. → testes em Task 3 e Task 4.
3. **Fechar o app com o servidor do opencode rodando** — nenhum processo `opencode` fica órfão. → passo de verificação em Task 7.
4. **Sessão salva que a CLI já não reconhece** (apagada, expirada) — o pedido cai para sessão nova, com um aviso no chat, sem erro. → teste em Task 5.
5. **Pergunta pendente e o Natan cancela o pedido** — a pergunta se resolve como "sem resposta", nada trava. → teste em Task 6.

---

## File Structure

```
scripts/spike/antigravity.mjs · scripts/spike/opencode.mjs · scripts/spike/ask-question.mjs
docs/superpowers/spike-fase-3a.md
src/shared/agents.ts                    troca availableInPhase por `requires: ToolKind` (ferramenta exigida)
src/shared/events.ts                    + { type: 'question' } / { type: 'question_answered' } / { type: 'notice' }
src/shared/models.ts                    + ToolStatus, TimeApi.toolStatus(), TimeApi.answerQuestion()
src/main/tools/detect.ts                quais CLIs estão instalados e logados
src/main/adapters/env.ts                lista única de variáveis removidas (Global Constraints)
src/main/adapters/antigravity.ts        buildAgyArgs, mapAgyEvent, AntigravityAdapter
src/main/adapters/opencode.ts           OpencodeHost (servidor único), mapOpencodeEvent, OpencodeAdapter
src/main/adapters/claude.ts             + AskUserQuestion → evento question
src/main/runs/runService.ts             + retomada de sessão, perguntas, ferramenta indisponível
src/main/store/db.ts                    + lastSessionFor(conversationId, agentId)
src/renderer/components/QuestionCard.tsx
src/renderer/state/chat.ts · src/renderer/stage/derive.ts   pergunta → pose waiting; travado por ferramenta
```

---

### Task 1: Spike — Antigravity, opencode e pergunta do Claude

Sem TDD. **Pré-requisito do Natan** (o executor pede e espera a confirmação dele):
o Antigravity (`agy`) já está instalado e logado (confirmado em 2026-10-31). Falta o opencode:
```bash
npm i -g opencode-ai@1.19.5
```
```bash
opencode auth login
```
(escolher o provedor da assinatura dele).

**Files:** Create `scripts/spike/antigravity.mjs`, `scripts/spike/opencode.mjs`, `scripts/spike/ask-question.mjs`, `docs/superpowers/spike-fase-3a.md`; `npm i -E @opencode-ai/sdk@1.19.5`.

- [ ] **Step 1: `antigravity.mjs`** — já confirmado à mão em 2026-10-31: `agy -p "…" --output-format stream-json --mode plan` lê arquivos, pesquisa na web, **bloqueia** `write_file` no projeto e autentica pelo login. Eventos: `{event:'init', conversation_id, init:{cwd, tools}}`, `{event:'step_update', step_update:{step_index, state:'ACTIVE'|'DONE'|'ERROR', step_type:'agent_response'|'tool'|'user_input', text_delta?, tool_name?, tool_info:{name, parameters}}}`, `{event:'result', result:{conversation_id, status:'SUCCESS'|…, response}}`. O script grava essas linhas como fixture e testa o que falta: retomar com `--conversation <id>`; desligar plugins/MCP do usuário (`--settings` com as chaves de settings.json que desativam MCP/plugins, `--disable-slash-commands`); comportamento de `--sandbox`; e que no modo `plan` nenhum comando de terminal que altere arquivos roda.
- [ ] **Step 2: Rodar.** Esperado: retomada mantém contexto (segunda pergunta "qual arquivo você leu?" responde `hello.txt`); plugins/MCP do usuário fora da lista `init.tools`; nada escrito no projeto.
- [ ] **Step 3: `opencode.mjs`** — `createOpencode({ config: { mcp: {}, permission: { edit: 'allow', bash: 'ask', webfetch: 'ask' } } })`; cria sessão apontando para a pasta temporária (confirmar se é por `cwd` do processo ou parâmetro `directory`/`query`); assina `client.event.subscribe()`; manda prompt "rode `ls` e depois `npm install left-pad`"; ao receber o evento de permissão, imprime e responde **rejeitar** via `postSessionIdPermissionsPermissionId`; depois `server.close()`.
- [ ] **Step 4: Rodar.** Esperado: chega evento de permissão para o `npm install`; a rejeição é respeitada; `ls` roda sem pedir (ou pede — anotar); o processo do servidor some após `close()` (conferir com `pgrep -f "opencode serve"`). Anotar: provedor/modelo usado pela assinatura do Natan; formato dos eventos de mensagem, ferramenta, permissão, fim e erro; como abortar (`session.abort`); se dá para retomar sessão por id.
- [ ] **Step 5: `ask-question.mjs`** — Claude Agent SDK (mesmas opções do adaptador da Fase 1) com prompt "Antes de começar, use a ferramenta AskUserQuestion para me perguntar qual nome dar ao arquivo, depois crie o arquivo". Em `canUseTool`, quando `toolName === 'AskUserQuestion'`, imprime o `input` e devolve `{ behavior: 'allow', updatedInput: { ...input, answers: { [pergunta]: 'resposta-teste.txt' } } }`. Esperado: arquivo `resposta-teste.txt` criado. Anotar o formato real do `input` e da resposta aceita.
- [ ] **Step 6:** Registrar tudo em `docs/superpowers/spike-fase-3a.md` (sim/não por item, formatos reais, decisões). **Se Antigravity ou opencode exigirem chave de API para funcionar, parar e perguntar ao Natan.**
- [ ] **Step 7: Commit** `chore: spike da fase 3A (antigravity, opencode, pergunta)`.

---

### Task 2: Detecção de ferramentas e destravamento do elenco

**Files:**
- Create: `src/main/tools/detect.ts`
- Modify: `src/shared/agents.ts`, `src/shared/models.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/runs/runService.ts`, `src/renderer/stage/derive.ts`, `src/renderer/state/runStore.ts`, `src/renderer/components/Composer.tsx`
- Test: `tests/main/tools/detect.test.ts`, ajustes em `tests/shared/agents.test.ts`, `tests/renderer/stage/derive.test.ts`, `tests/main/runs/runService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared/models.ts
  export interface ToolStatus { tool: ToolKind; installed: boolean; loggedIn: boolean; version?: string; hint?: string }
  // TimeApi + toolStatus(): Promise<Record<ToolKind, ToolStatus>>
  // shared/agents.ts: AgentDef perde `availableInPhase`; a ferramenta exigida é o próprio `tool`.
  // main/tools/detect.ts
  export type Exec = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>
  export async function detectTools(exec: Exec, home = os.homedir()): Promise<Record<ToolKind, ToolStatus>>
  // renderer/stage/derive.ts
  export function deriveStage(chat: ChatState, now: number, tools?: Record<ToolKind, ToolStatus>): Record<AgentId, MascotView>
  ```
  `installed` = `<cli> --version` sai com 0 (`claude`, `codex`, `agy` para o kind `gemini`, `opencode`). `loggedIn` = existe a credencial do login no disco (`~/.gemini/antigravity-cli/antigravity-oauth-token` para o Antigravity; opencode conforme o spike, ex.: `~/.local/share/opencode/auth.json`; Claude e Codex: `true` se instalados). `hint` em PT-BR: não instalado → `Instale o Antigravity` / `Instale o opencode`; instalado e deslogado → `Entre no Antigravity` / `Entre no opencode`.
- Travamento: `deriveStage` usa `pose 'locked'` e `label = hint` quando a ferramenta do agente não está `installed && loggedIn`; sem `tools` (carregando), todos liberados. `RunService.start` com ferramenta indisponível → `Error('TOOL_UNAVAILABLE')` (substitui `AGENT_NOT_AVAILABLE`); `Composer` mostra o `hint` correspondente.

- [ ] **Step 1: Testes que falham:** `detectTools` com `Exec` falso cobrindo: tudo instalado e logado; `agy` ausente (`code 127`) → `{installed:false, hint:'Instale o Antigravity'}`; `opencode` instalado sem `auth.json` → `{installed:true, loggedIn:false, hint:'Entre no opencode'}`; versão lida do stdout. `deriveStage(..., tools)` com Antigravity ausente → Radar `{pose:'locked', label:'Instale o Antigravity'}`; o rótulo da ferramenta do Radar no palco passa a ser `Antigravity`; sem `tools` → Radar `idle`. `agents.test.ts`: nenhum agente tem `availableInPhase`. `RunService.start` para Radar sem adaptador → `TOOL_UNAVAILABLE` sem criar run.
- [ ] **Step 2:** FAIL. **Step 3:** implementar; IPC `toolStatus` chama `detectTools` com `execFile` real (timeout 5 s) e guarda em cache por 60 s; `runStore` carrega no início e o `Stage`/`Composer` usam. **Step 4:** `npm test` PASS; `npx tsc -b` limpo.
- [ ] **Step 5: Commit** `feat: detecção dos CLIs e elenco liberado por ferramenta`.

---

### Task 3: Adaptador Antigravity (Radar)

**Files:**
- Create: `src/main/adapters/env.ts`, `src/main/adapters/antigravity.ts`
- Modify: `src/main/adapters/claude.ts`, `src/main/adapters/codex.ts` (passam a usar a lista de `env.ts`), `src/main/index.ts` (registrar `gemini: new AntigravityAdapter()`)
- Test: `tests/main/adapters/antigravity.test.ts`, `tests/main/adapters/env.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // env.ts
  export const BLOCKED_ENV: ReadonlySet<string>        // Global Constraints
  export function safeEnv(extraDrop?: (k: string) => boolean): Record<string, string>
  // antigravity.ts
  export function buildAgyArgs(opts: AdapterRunOptions): string[]   // -p <prompt>, --output-format stream-json, --mode plan, --disable-slash-commands, --settings (sem MCP/plugins), --model se houver, --conversation se houver
  export function mapAgyEvent(line: string, cwd: string, state: { sessionId?: string; toolSteps: Set<number> }): AgentEvent[]
  export class AntigravityAdapter implements AgentAdapter { constructor(spawnFn = child_process.spawn) }
  ```
  Prompt enviado = `systemAppend(agent, instructions)` + pedido (como no Codex). `mapAgyEvent`: `init` guarda `conversation_id`; `step_update` de `agent_response` acumula `text_delta` e emite **um** `text` quando o passo chega a `DONE` (texto vazio não emite); `step_update` de `tool` em `ACTIVE` emite `tool` uma vez por `step_index` (nomes do Antigravity mapeados: `read_file`→`Read`, `list_dir`/`grep_search`/`find_by_name`→`Grep`, `search_web`/`read_url_content`→`WebSearch`; `Path`→`file_path` para o resumo relativo); escrita bloqueada (`ERROR`) não emite nada; `result` com `status:'SUCCESS'` → `done {sessionId}`, outro status → `error` com `response`; linha que não é JSON → ignorada. Processo: `spawn('agy', args, { cwd, env: safeEnv() })`, linhas lidas de `stdout`; `opts.signal` aborta com `SIGTERM` e, após 2 s, `SIGKILL`; código de saída ≠ 0 sem `result` → `error` com as últimas 5 linhas do `stderr`.

- [ ] **Step 1: Testes que falham:** `safeEnv` remove cada variável de `BLOCKED_ENV` e mantém `PATH`; Claude e Codex continuam passando nos testes existentes usando `safeEnv`. `buildAgyArgs` contém `-p` com o prompt montado, `--output-format stream-json` e as flags de "sem plugins/MCP"; com `model` → `--model`, com `resumeSessionId` → `--conversation <id>`. `mapAgyEvent` com as linhas reais gravadas no spike (fixtures em `tests/main/adapters/fixtures/agy-*.jsonl`): um `text` com a frase completa (deltas juntados), `tool` para `read_file` (`hello.txt`) e `search_web`, nada para o `write_file` com `ERROR`, `done` com o `conversation_id`. `buildAgyArgs` contém `--mode plan` e **nunca** `--dangerously-skip-permissions` nem `--mode auto`/`accept-edits`. `AntigravityAdapter` com um `spawn` falso (EventEmitter + streams): emite eventos na ordem; **Review Focus 2:** abortar envia `SIGTERM` e, se o processo não sair em 2 s (timers falsos), `SIGKILL`; saída com código 1 e stderr → `error`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: adaptador Antigravity só leitura para o Radar`.

---

### Task 4: Adaptador opencode (Curinga)

**Files:**
- Create: `src/main/adapters/opencode.ts`
- Modify: `src/main/index.ts` (registrar; fechar o servidor em `before-quit`)
- Test: `tests/main/adapters/opencode.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface OpencodeClientLike { /* só o que o adaptador usa: session.create/prompt/abort, event.subscribe, resposta de permissão — nomes reais do spike */ }
  export class OpencodeHost {
    constructor(start: () => Promise<{ client: OpencodeClientLike; close(): void }>)
    client(): Promise<OpencodeClientLike>   // sobe o servidor na primeira chamada e reaproveita
    close(): void
  }
  export function mapOpencodeEvent(ev: unknown, sessionId: string, cwd: string): AgentEvent[]
  export function permissionToToolCall(ev: unknown): { toolName: string; input: Record<string, unknown> }   // ex.: bash → { toolName: 'Bash', input: { command } }
  export class OpencodeAdapter implements AgentAdapter { constructor(host: OpencodeHost) }
  ```
  `start` real: `createOpencode({ config: { mcp: {}, permission: { edit: 'allow', bash: 'ask', webfetch: 'ask' } } })` com `safeEnv()` no processo do servidor (como o SDK permitir — spike). Por pedido: cria (ou retoma) sessão na pasta do projeto, assina eventos filtrando pelo `sessionId`, envia o prompt (`systemAppend` + pedido). Pedido de permissão → `permissionToToolCall` → `classifyToolCall`: `allow` responde "uma vez" sem perguntar; `ask` chama `requestApproval` e responde "uma vez" ou "rejeitar". `opts.signal` → `session.abort`. Fim do turno → `done {sessionId}`.

- [ ] **Step 1: Testes que falham** com `OpencodeClientLike` falso (fixtures do spike em `tests/main/adapters/fixtures/opencode-*.json`):
  - `OpencodeHost.client()` chamado duas vezes sobe o servidor **uma** vez; `close()` fecha.
  - Eventos de texto/ferramenta/fim → `text`/`tool`/`done{sessionId}`; eventos de outra sessão são ignorados.
  - Permissão de `ls` → respondida como permitida **sem** chamar `requestApproval`; permissão de `npm install x` → `requestApproval({ toolName: 'Bash', summary: 'npm install x' })`, `false` → resposta "rejeitar".
  - **Review Focus 2:** abortar chama `session.abort` daquela sessão, o gerador termina, e um segundo `run` no mesmo host funciona (o servidor não foi fechado).
  - Falha ao subir o servidor → `error` com mensagem `Não consegui iniciar o opencode: …`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar; `before-quit` chama `host.close()`. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: adaptador opencode com aprovação real para o Curinga`.

---

### Task 5: Conversa contínua

**Files:**
- Modify: `src/main/store/db.ts`, `src/main/runs/runService.ts`, `src/shared/events.ts`, `src/renderer/state/chat.ts`, `src/renderer/components/ChatPanel.tsx`
- Test: `tests/main/store/db.test.ts`, `tests/main/runs/runService.test.ts`, `tests/renderer/runStore.test.ts`

**Interfaces:**
- Produces: `Store.lastSessionFor(conversationId: string, agentId: AgentId): string | null` (sessão do run mais recente **concluído** daquele agente naquela conversa); `RunEvent` + `{ type: 'notice'; text: string }`.
- `RunService.start` passa `resumeSessionId = store.lastSessionFor(...)` ao adaptador. Se o adaptador terminar com `error` **antes de qualquer outro evento** e havia `resumeSessionId`, o RunService tenta **uma** vez de novo sem retomar, emitindo antes `notice` "Não consegui retomar a conversa anterior do <Agente>; comecei uma nova." (o chat mostra como nota discreta).

- [ ] **Step 1: Testes que falham:** `lastSessionFor` ignora runs de outro agente, de outra conversa e runs `error`/`cancelled`; devolve o mais recente. RunService: segundo pedido ao mesmo agente na mesma conversa recebe `resumeSessionId` do primeiro; pedido em conversa nova não recebe. **Review Focus 4:** Fake que falha de cara quando recebe `resumeSessionId` e funciona sem → eventos `notice` + eventos do segundo intento + `run_finished{done}`; o adaptador foi chamado 2 vezes. Reducer: `notice` aparece no bloco do run.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: conversa contínua com retomada de sessão por agente`.

---

### Task 6: Pergunta em texto livre

**Files:**
- Create: `src/renderer/components/QuestionCard.tsx`
- Modify: `src/shared/events.ts`, `src/shared/models.ts`, `src/main/adapters/types.ts`, `src/main/adapters/claude.ts`, `src/main/runs/runService.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/state/chat.ts`, `src/renderer/stage/derive.ts`, `src/renderer/components/ChatPanel.tsx`, `src/shared/agents.ts` (persona)
- Test: `tests/main/adapters/claude.test.ts`, `tests/main/runs/runService.test.ts`, `tests/renderer/runStore.test.ts`, `tests/renderer/stage/derive.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // events.ts
  | { type: 'question'; id: string; text: string; options?: string[] }
  | { type: 'question_answered'; id: string; answer: string | null }
  // AdapterRunOptions + askUser(q: { text: string; options?: string[] }): Promise<string | null>
  // TimeApi + answerQuestion(id: string, answer: string): Promise<void>
  ```
  Claude: em `makeCanUseTool`, `AskUserQuestion` chama `opts.askUser` para cada pergunta do `input` (formato do spike) e devolve `allow` com as respostas no `updatedInput`; resposta `null` → `deny` com "O Natan não respondeu; siga com a opção mais sensata e registre a suposição." Demais adaptadores não perguntam: as personas de Lupa, Radar e Curinga ganham a frase "Se faltar informação, assuma o mais sensato e diga qual suposição fez." RunService: `askUser` emite `question`, espera `answerQuestion` ou abort (abort → `null`), emite `question_answered`. Reducer: pergunta pendente põe o agente em `esperando`; `deriveStage`: pergunta pendente → `waiting`, balão `alert` "Tenho uma pergunta". `QuestionCard`: texto, botões para cada opção (se houver) e campo livre com "Responder".

- [ ] **Step 1: Testes que falham:** `makeCanUseTool` com `AskUserQuestion` (input do spike) chama `askUser` e devolve o `updatedInput` no formato aceito; `null` → `deny` com a mensagem acima. **Review Focus 5:** RunService com pergunta pendente + `cancel` → `askUser` resolve `null`, `question_answered{answer:null}`, `run_finished{cancelled}`. Reducer e `deriveStage` conforme acima. Personas: Lupa, Radar e Curinga contêm "assuma o mais sensato".
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; `npx tsc -b` limpo.
- [ ] **Step 5: Commit** `feat: agente pode fazer pergunta em texto livre`.

---

### Task 7: Verificação no app

Sem código novo, salvo correções. Pasta descartável `~/Documents/www/projects/time-teste-fase1`, resetada antes. Script `scripts/e2e/verify-fase3a.mjs` (base: `verify-fase2.mjs`).

- [ ] **Step 1:** Palco: Radar e Curinga **sem** `locked` (CLIs instalados e logados); nenhum erro no console.
- [ ] **Step 2: Radar** — "Pesquise a versão LTS atual do Node.js e diga em uma linha, citando a fonte". Esperado: resposta com link; `git status` inalterado; passou por `working` com balão "Lendo…"/"WebSearch…".
- [ ] **Step 3: Curinga** — "Crie src/mult.js com mult(a,b) e depois rode npm install left-pad". Esperado: arquivo criado sem pedir; card de aprovação para `npm install left-pad`; negar → `package.json` inalterado.
- [ ] **Step 4: Conversa contínua** — na mesma conversa, Forja: "Crie src/sub.js com sub(a,b)"; depois Forja: "Qual arquivo você acabou de criar? Responda só o caminho." Esperado: resposta `src/sub.js`.
- [ ] **Step 5: Pergunta** — Forja: "Antes de criar o arquivo, me pergunte qual nome usar, depois crie com esse nome". Esperado: `QuestionCard` aparece, mascote em `waiting` com "Tenho uma pergunta"; responder `pergunta-ok.js` → arquivo criado com esse nome.
- [ ] **Step 6: Cancelamento** — Radar com pedido longo; cancelar em 3 s → `pgrep -f "agy -p"` vazio em até 3 s.
- [ ] **Step 7 (Review Focus 3):** com um pedido do Curinga já feito, fechar o app → `pgrep -f "opencode serve"` vazio em até 3 s.
- [ ] **Step 8:** Registrar em `docs/superpowers/spike-fase-3a.md` (seção "Verificação") com prints em `docs/superpowers/verificacao-fase-3a/`; commit `docs: verificação da fase 3A`.
