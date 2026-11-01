# Tutti — Custos e Perfis, Parte 1: Uso, gatilho e contexto compartilhado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No perfil Padrão (o time de hoje, por CLI): o Tutti mede tokens e o uso do limite de cada assinatura, mostra isso num painel fino no canto inferior direito, avisa quando uma ferramenta passa do limite configurado e oferece passar o trabalho para outro agente; e todo agente chamado numa conversa passa a saber o que os outros já disseram.

**Architecture:** Os adaptadores emitem dois eventos novos — `usage` (tokens de um turno) e `limit` (uso de uma janela da assinatura, quando a ferramenta informa). O `RunService` grava tudo no SQLite; um `UsageService` no processo principal agrega por ferramenta e janela, estima onde não há número oficial, decide os avisos e empurra um `UsageSnapshot` para o painel. O contexto compartilhado é montado por uma função pura a partir do histórico da conversa no banco e entra no início do prompt.

**Tech Stack:** o que já existe.

**Spec:** `docs/superpowers/specs/2026-11-01-custos-e-perfis-design.md` — §4 (painel), §5 (gatilho; o caso "destino por API paga" fica para a Parte 2, que é quando existem agentes de API), §7 (contexto compartilhado), §9 (medição).

**Parte 2 (plano separado, depois desta):** perfis, tela de configuração, papéis (revisa/pode ser consultado), modo API pelo opencode com chaves no Keychain, mascote pela família do modelo, confirmações de API paga.

## Global Constraints

- Nada de valor em dinheiro nesta parte (spec §2).
- **Uma linha por ferramenta** no painel: Claude Code, Codex, Antigravity, opencode. Barra fina (3 px) na cor do **primeiro agente do perfil** que usa a ferramenta (Claude → Bússola `#d97757`, Codex → Lupa `#3d6df2`, Antigravity → Radar `#8a7cf0`, opencode → Curinga `#b9b9c2`) + porcentagem inteira + tokens enviados/recebidos da janela, em formato curto (`12,3 mil`).
- Claude: a barra é a janela de **5 horas**; o aviso usa a janela **mais usada** (5 h ou semanal) e diz qual. Onde não há número oficial: estimativa marcada "estimado" (teto configurável por ferramenta). opencode com modelos gratuitos: sem barra, só tokens.
- Tokens da linha zeram com a janela de 5 h (quando conhecida) ou à meia-noite local.
- Limite de alerta padrão **90%**, configurável no geral e por ferramenta; **um aviso por pedido por ferramenta**.
- Passar o trabalho: só com o "sim" do Natan; edições já feitas ficam; o substituto continua com contexto (spec §5). Destino = agente de ferramenta com folga, mesmo tipo (escreve/só lê), função mais próxima; com coordenador num pedido de time, o mesmo passo vira um novo filho do mesmo pedido.
- Contexto compartilhado: teto de **~6.000 tokens** (aprox. 24.000 caracteres); entra o que o spec §7 diz; agente que retoma a própria sessão recebe só o que ainda não viu.
- Textos em PT-BR.

## Review Focus

1. **Ferramenta que não informa nada** (sem limite, sem tokens) — a linha mostra "—" sem erro e nunca dispara aviso falso. → Task 4.
2. **Uso que oscila em volta do limite** (91%, 89%, 93% no mesmo pedido) — um único aviso por pedido por ferramenta. → Task 5.
3. **Ninguém com folga** quando o limite estoura — o aviso diz isso e só oferece [Continuar]. → Task 5.
4. **Passar com aprovação ou pergunta pendente** no agente original — o original fecha `cancelled` sem travar, o substituto começa com o pedido, o contexto e a lista do que já mudou. → Task 5.
5. **Conversa muito longa** — o contexto nunca passa do teto; mantém as trocas mais recentes inteiras e corta as antigas. → Task 3.

---

## File Structure

```
scripts/spike/usage.mjs                    spike: uso/limite de cada ferramenta
docs/superpowers/spike-uso.md
src/shared/usage.ts                        tipos: UsageTotals, LimitWindow, UsageSnapshot, UsageSettings
src/shared/events.ts                       + usage, limit, limit_warning, limit_resolved, handoff
src/main/adapters/{claude,codex,antigravity,opencode}.ts   + eventos usage/limit
src/main/store/db.ts                       + tabelas usage, limits, settings
src/main/usage/usageService.ts             agrega, estima, decide avisos, empurra snapshot
src/main/usage/handoff.ts                  escolhe o substituto (regra pura)
src/main/context/conversationContext.ts    monta o contexto compartilhado (puro)
src/main/runs/runService.ts                grava uso, injeta contexto, aviso e troca
src/main/team/teamService.ts               troca de passo dentro de um pedido de time
src/renderer/components/UsagePanel.tsx · UsageDetail.tsx · LimitWarningCard.tsx
src/renderer/state/usageStore.ts           estado do painel (zustand)
```

---

### Task 1: Spike — o que cada ferramenta informa de uso e limite

Sem TDD. **Files:** `scripts/spike/usage.mjs`, `docs/superpowers/spike-uso.md`.

- [ ] **Step 1: Claude.** Num pedido curto via SDK (opções do adaptador), imprimir todo `rate_limit_event` (campos de `rate_limit_info`) e o `usage` da mensagem `result`. Depois, no mesmo `Query`, chamar `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })` e imprimir `rate_limits` (5 h, semanal, por modelo, `resets_at`). Anotar se a chamada de uso consome chamada de modelo (deve ser só controle) e se dá para fazê-la sem pedido (ex.: `query` com prompt vazio/stream e só a chamada de controle).
- [ ] **Step 2: Codex.** Rodar um turno curto e imprimir `turn.completed.usage`. Procurar limite: eventos do SDK; logs locais em `~/.codex/sessions/**/*.jsonl` (entradas com `rate_limits`, `used_percent`, `window_minutes`, `resets_in_seconds`). Anotar caminho e formato se existir.
- [ ] **Step 3: Antigravity e opencode.** Confirmar `step_update.usage` (agy) e `session.step.ended.tokens` (opencode) num pedido curto; procurar qualquer campo de cota/limite. Anotar.
- [ ] **Step 4:** Registrar em `docs/superpowers/spike-uso.md`: por ferramenta, de onde vêm tokens e limite (oficial, log local ou nenhum). **Commit** `chore: spike de uso e limites`.

---

### Task 2: Eventos de uso nos adaptadores e gravação

**Files:** Create `src/shared/usage.ts`; Modify `src/shared/events.ts`, os quatro adaptadores, `src/main/store/db.ts`, `src/main/runs/runService.ts`; Test os testes de adaptador, `tests/main/store/db.test.ts`, `tests/main/runs/runService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared/usage.ts
  export interface TokenUsage { input: number; output: number; cacheRead: number; reasoning: number }
  export type WindowKind = 'five_hour' | 'seven_day' | 'seven_day_model' | 'estimated'
  export interface LimitWindow { tool: ToolKind; window: WindowKind; utilization: number /* 0–100 */; resetsAt?: number /* ms */; at: number }
  // events.ts (AgentEvent +=)
  | { type: 'usage'; tool: ToolKind; tokens: TokenUsage }
  | { type: 'limit'; limit: LimitWindow }
  // db.ts
  recordUsage(runId: string, agentId: AgentId, tool: ToolKind, tokens: TokenUsage, at: number): void
  recordLimit(l: LimitWindow): void
  tokensSince(tool: ToolKind, since: number): TokenUsage
  tokensByRun(conversationId: string): { runId: string; agentId: AgentId; tool: ToolKind; tokens: TokenUsage }[]
  tokensByDay(days: number): { day: string; projectPath: string; tool: ToolKind; tokens: TokenUsage }[]
  latestLimits(): LimitWindow[]       // a mais recente por (tool, window)
  ```
- Mapeamento (formatos do spike): Claude — `usage` do `result` → `usage`; cada `rate_limit_event` com `utilization` → `limit` (`rateLimitType` `five_hour`/`seven_day`; `seven_day_opus`/`seven_day_sonnet` → `seven_day_model`; `utilization` normalizada para 0–100). Codex — `turn.completed.usage` → `usage` (+ `limit` se o spike achou fonte). Antigravity — soma de `step_update.usage` dos passos `DONE` → um `usage` no `result`. opencode — soma de `session.step.ended.tokens` → um `usage` no fim.
- `RunService.execute`: eventos `usage`/`limit` são gravados com `recordUsage`/`recordLimit` e **também** emitidos ao renderer, mas não entram no histórico de eventos do run (não poluem o chat).

- [ ] **Step 1: Testes que falham:** cada adaptador emite `usage` com os números da fixture correspondente (criar fixtures pequenas a partir do spike: `claude-result-usage.json`, `claude-rate-limit.json`, `codex-turn-usage.json`; agy e opencode já têm fixtures com tokens); Claude converte `rateLimitType: 'seven_day_opus'` em `seven_day_model` e `utilization: 0.62` em `62`. Store: `tokensSince` soma só da ferramenta e depois de `since`; `latestLimits` devolve a mais recente por par; `tokensByRun` agrupa por run. RunService: um Fake que emite `usage` e `limit` → gravados e emitidos, mas `store.listEvents(runId)` não os contém.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; `npx tsc -b`. **Step 5: Commit** `feat: medição de tokens e limites por ferramenta`.

---

### Task 3: Contexto compartilhado da conversa

**Files:** Create `src/main/context/conversationContext.ts`; Modify `src/main/runs/runService.ts`, `src/main/team/prompts.ts`; Test `tests/main/context/conversationContext.test.ts`, `tests/main/runs/runService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ContextEntry { at: number; who: 'natan' | AgentId; kind: 'pedido' | 'resposta' | 'consulta' | 'time'; text: string }
  export function collectEntries(store: Store, conversationId: string): ContextEntry[]    // a partir de runs + eventos gravados
  export function buildContext(entries: ContextEntry[], opts: { forAgent: AgentId; sinceAt?: number; maxChars?: number /* 24_000 */ }): string
  ```
- `collectEntries`: por run da conversa, em ordem: o `prompt` do run de topo (pedido do Natan) → `pedido`; o texto final (`text` acumulado) de cada run de agente → `resposta` com o agente; `agent_call`+`agent_call_answer` → `consulta` ("Forja perguntou ao Radar: … / Radar: …"); run-pai de time → `time` com `lineup.summary` e os caminhos do `diff`. Não entram: triagem, confirmações, passos, diffs completos.
- `buildContext`: se `sinceAt`, só entradas depois dele **e** que não sejam do próprio `forAgent`; formato `### Conversa até aqui\n[Natan] …\n[Claude/Forja] …`; mantém as mais recentes inteiras e, se passar de `maxChars`, corta as mais antigas e põe `(… N mensagens anteriores omitidas)` no topo; texto de uma entrada maior que 4.000 caracteres é cortado com `…`. Vazio → `''`.
- `RunService.execute`: antes de chamar o adaptador, `prefix = buildContext(collectEntries(...), { forAgent, sinceAt: resume ? <fim do último run desse agente na conversa> : undefined })`; prompt = `prefix + '\n\n' + prompt` quando `prefix` não é vazio. Runs-filhos de time recebem o mesmo (o `childPrompt` não muda). Confirmações e consultas (`mode: 'consult'`) **não** recebem contexto (economia).

- [ ] **Step 1: Testes que falham:** `collectEntries` numa conversa com: pedido direto ao Forja + resposta; pedido ao Radar + resposta; pedido de time com triagem/confirmações/escalação/diff e filhos com respostas; consulta Forja→Radar — devolve exatamente os tipos/textos acima e nada da triagem/confirmações. `buildContext`: exemplo do Natan (Claude respondeu; agora o Gemini) contém a resposta do Claude; `sinceAt` exclui o que o próprio agente disse e o que é anterior; **Review Focus 5:** 200 entradas de 500 caracteres com `maxChars: 24_000` → saída ≤ 24.000, contém a última entrada inteira e a nota de omitidas; entrada de 10.000 caracteres vira 4.000 + `…`. RunService: segundo pedido a outro agente na mesma conversa recebe o prefixo com a resposta do primeiro; pedido em conversa nova não recebe prefixo; agente que retoma sessão recebe só o novo.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5: Commit** `feat: contexto compartilhado entre agentes na conversa`.

---

### Task 4: UsageService — agregação, estimativa e snapshot do painel

**Files:** Create `src/main/usage/usageService.ts`; Modify `src/main/store/db.ts` (tabela `settings` chave/valor), `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/models.ts`, `src/shared/usage.ts`; Test `tests/main/usage/usageService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared/usage.ts
  export interface ToolUsageRow { tool: ToolKind; utilization: number | null; estimated: boolean; window: WindowKind | null; resetsAt?: number; tokens: TokenUsage; alert: boolean }
  export interface UsageSnapshot { rows: ToolUsageRow[]; at: number }
  export interface UsageSettings { alertAt: number /* 90 */; perTool: Partial<Record<ToolKind, { alertAt?: number; estimateCeilingTokens?: number }>> }
  // usageService.ts
  export class UsageService {
    constructor(deps: { store: Store; now?: () => number; emit(s: UsageSnapshot): void; pollClaude?: () => Promise<LimitWindow[]> })
    onEvent(runId: string, agentId: AgentId, ev: AgentEvent): void   // chamado pelo RunService para usage/limit
    snapshot(): UsageSnapshot
    settings(): UsageSettings; updateSettings(s: Partial<UsageSettings>): void
    startPolling(intervalMs?: number): () => void                    // Claude: consulta de uso a cada 5 min (se o spike mostrou que é só controle)
  }
  // TimeApi + usageSnapshot(), usageDetail(conversationId), usageSettings(), updateUsageSettings(s), onUsage(cb)
  ```
- Regras do snapshot por ferramenta: Claude → `utilization` da janela `five_hour` mais recente (null se nunca veio), `alert` se **qualquer** janela ≥ `alertAt`; tokens desde `resetsAt − 5 h` da janela de 5 h, ou desde a meia-noite. Ferramentas sem limite oficial: se há `estimateCeilingTokens`, `utilization = tokens desde meia-noite / teto × 100` com `estimated: true`; senão `utilization: null`. opencode: sempre `utilization: null`. Snapshot emitido a cada `usage`/`limit` (no máximo 1 por segundo).

- [ ] **Step 1: Testes que falham** (store `:memory:`, `now` controlado): Claude com `limit five_hour 62` e `seven_day 91` → linha `utilization: 62`, `alert: true`; tokens contados só depois do início da janela; ferramenta sem dados (**Review Focus 1**) → `utilization: null`, `tokens` zerados, `alert: false`; Codex com teto 1.000.000 e 250.000 tokens hoje → `25`, `estimated: true`; virada da meia-noite zera tokens estimados; `updateSettings({ perTool: { claude: { alertAt: 60 } } })` muda o `alert`; emissões limitadas a 1 por segundo.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (configurações persistidas na tabela `settings`, chave `usage`). **Step 4:** PASS. **Step 5: Commit** `feat: agregação de uso e snapshot do painel`.

---

### Task 5: Aviso de limite e troca de agente

**Files:** Create `src/main/usage/handoff.ts`; Modify `src/main/usage/usageService.ts`, `src/main/runs/runService.ts`, `src/main/team/teamService.ts`, `src/shared/events.ts`, IPC/preload/models; Test `tests/main/usage/handoff.test.ts`, `tests/main/runs/runService.test.ts`, `tests/main/team/teamService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // events.ts (RunEvent +=)
  | { type: 'limit_warning'; id: string; tool: ToolKind; window: WindowKind; utilization: number; to?: AgentId }   // `to` ausente = ninguém com folga
  | { type: 'limit_resolved'; id: string; pass: boolean }
  | { type: 'handoff'; to: AgentId; newRunId: string }
  // handoff.ts
  export function pickReplacement(from: AgentId, available: AgentId[], snapshot: UsageSnapshot, alertAt: (t: ToolKind) => number): AgentId | undefined
  // RunService / TimeApi
  respondLimit(warningId: string, pass: boolean): void
  ```
- `pickReplacement`: candidatos = disponíveis, ≠ `from`, mesmo `readOnly`, ferramenta ≠ a do `from`, ferramenta abaixo do próprio `alertAt` (ou sem número); ordem: menor `utilization` (null conta como 0), depois função mais parecida (mesmas palavras em `funcao`), depois ordem do elenco.
- Fluxo: `UsageService` avisa o `RunService` quando uma ferramenta cruza o limite (`onCross(tool, window, utilization)`); para cada run **rodando** naquela ferramenta que ainda não recebeu aviso dessa ferramenta (**Review Focus 2**), o `RunService` emite `limit_warning` com `to = pickReplacement(...)`. `respondLimit(id, false)` → `limit_resolved{pass:false}`, segue. `respondLimit(id, true)` → cancela o run original (aprovações/perguntas pendentes resolvem como negadas — já é o comportamento de `cancel`) e inicia o substituto: pedido direto → `start` de um run novo na mesma conversa com prompt = pedido original + "Você está assumindo o trabalho do <Agente>, que parou no limite da assinatura. Arquivos que ele já alterou: <lista dos file_changed>. Continue de onde ele parou." (o contexto compartilhado da Task 3 entra sozinho), pelo caminho normal de `start` (entra na fila do projeto — com o projeto livre, começa assim que o original fechar — e tem ponto de restauração e diff próprios; o diff do original continua mostrando o que ele fez); filho de time → o `TeamService` troca o passo: novo filho do mesmo pai com o mesmo `task`, o pai espera o novo filho no lugar do antigo. Emite `handoff` no run original.

- [ ] **Step 1: Testes que falham:** `pickReplacement`: Forja (claude, escreve) com Claude em 92% → Curinga (opencode, escreve) se Codex/agy são só leitura; ninguém abaixo do limite → `undefined`; Radar (só lê) → Lupa. RunService (**Review Focus 2**): três `limit` 91/89/93 no mesmo run → um `limit_warning`; (**Review Focus 3**) sem substituto → `limit_warning` sem `to`, e `respondLimit(id, true)` não faz nada além de `limit_resolved{pass:false}`; (**Review Focus 4**) run original com aprovação pendente + `respondLimit(id, true)` → original `cancelled`, aprovação resolvida `false`, novo run do Curinga com prompt contendo "assumindo o trabalho do Forja" e a lista de arquivos, `handoff` emitido. TeamService: filho Forja substituído pelo Curinga no mesmo passo; o pai termina `done` quando o Curinga termina; `diff` do pai inclui o que os dois mudaram.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5: Commit** `feat: aviso de limite com troca de agente`.

---

### Task 6: Painel de uso e aviso no chat

**Files:** Create `src/renderer/components/{UsagePanel,UsageDetail,LimitWarningCard}.tsx`, `src/renderer/state/usageStore.ts`; Modify `src/renderer/App.tsx`, `src/renderer/state/chat.ts`, `src/renderer/components/ChatPanel.tsx`, `src/renderer/styles.css`; Test `tests/renderer/usage.test.ts`, `tests/renderer/runStore.test.ts`

**Interfaces / comportamento:**
- `formatTokens(n: number): string` (`950` → `950`; `12_345` → `12,3 mil`; `1_234_567` → `1,2 mi`).
- `UsagePanel`: fixo no canto inferior direito do palco (acima do campo de pedido, sem cobrir mascotes), largura ~220 px, recolhível (estado em `localStorage`); uma linha por `ToolUsageRow`: nome · barra 3 px na cor da ferramenta (Global Constraints) preenchida até `utilization` · `62%` (ou `—`) · `↑ 12,3 mil ↓ 4,1 mil`; `estimated` → sufixo discreto "estimado"; `alert` → barra e número em `#f87171`. Clique abre `UsageDetail`: tokens por agente e por pedido da conversa aberta (`usageDetail`), últimos 7 dias por projeto/ferramenta, e campos para "avisar em __%" (geral e por ferramenta) e "teto estimado (tokens/dia)" por ferramenta sem número oficial.
- `LimitWarningCard` no bloco do run: "O Claude está em 92% do limite de 5 horas. Posso passar o trabalho do Forja para o Curinga?" [Passar] [Continuar]; sem `to`: "…e nenhum outro agente tem folga agora." só [Continuar]. Respondido → texto curto do resultado. `handoff` → nota "Trabalho passado para o Curinga".
- Palco: agente com aviso pendente → `waiting` com balão "Limite quase no fim".

- [ ] **Step 1: Testes que falham:** `formatTokens`; reducer: `limit_warning` cria cartão pendente e agente `esperando`; `limit_resolved` fecha; `handoff` guarda a nota; `deriveStage`: aviso pendente → `waiting` + "Limite quase no fim"; `usageStore` aplica snapshots (último vence).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; `npx tsc -b`; `npm run build`. **Step 5: Commit** `feat: painel de uso e aviso de limite no chat`.

---

### Task 7: Verificação no app

Script `scripts/e2e/verify-uso.mjs` (base dos anteriores), pasta descartável resetada.

- [ ] **Step 1:** App aberto: painel no canto inferior direito com as quatro linhas; Claude com porcentagem real (se a consulta de uso funcionou no spike) ou "—" até o primeiro pedido.
- [ ] **Step 2:** Pedido ao Forja: tokens do Claude sobem no painel ao fim; Radar depois: tokens do Antigravity sobem.
- [ ] **Step 3: Contexto** — Forja: "Diga uma cor qualquer em uma palavra." → depois Radar: "Qual cor o Forja disse? Responda só a cor." → resposta igual.
- [ ] **Step 4: Gatilho** — ajustar "avisar em" do Claude para 1% pelo detalhe do painel; pedido ao Forja → `LimitWarningCard` com destino; [Passar] → Forja `cancelled`, Curinga assume e termina; voltar o ajuste para 90%.
- [ ] **Step 5:** Registrar em `docs/superpowers/spike-uso.md` (seção Verificação) com prints em `docs/superpowers/verificacao-uso/`; commit `docs: verificação de uso, gatilho e contexto`.
