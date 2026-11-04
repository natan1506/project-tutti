# Autonomia em 3 níveis e Parar tudo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Natan escolhe por projeto entre "Perguntar tudo", "Aceitar edições" e "Sozinho", e tem um botão (e ⌘ + .) que para todo trabalho do app sem perder o que foi feito.

**Architecture:** Uma função de política (`decide`) passa a receber o nível e se o agente está em sandbox, e devolve a decisão com o motivo. Claude e opencode já passam toda permissão por ela. No Sozinho, os agentes Claude rodam com o sandbox do macOS do Agent SDK (escrita só no projeto); o opencode usa uma lista de comandos ampliada. O "Parar tudo" aborta todos os controladores do `RunService` (diretos, Time, filhos e fila; consultas e chamadas do coordenador seguem esses sinais) e as execuções de skill.

**Tech Stack:** Electron 45, React 19, TS, zustand, vitest, `@anthropic-ai/claude-agent-sdk` 0.3.314 (`sandbox`), opencode 2.x.

**Spec:** `docs/superpowers/specs/2026-11-04-escritorio-autonomia-vozes-design.md` (§4 e §5; vozes e escritório ficam para outros planos).

## Global Constraints

- Níveis e textos exatos: `Perguntar tudo` · `Aceitar edições` (padrão) · `Sozinho`.
- "Aceitar edições" é exatamente o comportamento de hoje: nenhum teste atual da política pode mudar de resultado.
- Destrutivo pede em **todos** os níveis (lista do spec §4.1); qualquer `git push` e `curl`/`wget` encadeado para shell pedem sempre. `pip install` pede sempre: o spec diz "fora de venv", mas pelo comando não dá para saber se há venv ativo, então fica do lado seguro (decisão do plano).
- Escrita fora do projeto e em `.git/` pede sempre (fora do sandbox); no sandbox, `.git/hooks` e `.git/config` ficam em `denyWrite`.
- Internet (`WebFetch`, `WebSearch`, `webfetch` do opencode) é livre só no Sozinho.
- Consultas (`mode: 'consult'`) continuam só leitura em qualquer nível; Codex e Antigravity não mudam.
- Nível por projeto, guardado na configuração `autonomy:<caminho absoluto do projeto>`; ausente = `accept_edits`.
- Parar tudo: sem confirmação, atalho ⌘ + ., para runs de todos os projetos e a fila, e as execuções de skill; o aviso de limite fecha como "Continuar" (`limit_resolved pass:false`, já é o que acontece no fim de um run).
- Interface em português do Brasil; renderer com `afterEach(cleanup)`.

## Review Focus

1. Nível trocado no meio de um pedido → a próxima permissão já usa o nível novo (Task 3).
2. Agente Claude com o nível em Sozinho mas sem sandbox (sandbox indisponível, ou o nível virou Sozinho depois que o pedido começou) → age como "Aceitar edições", nunca livre sem barreira (Task 3).
3. Comando destrutivo escondido no meio de um encadeamento (`npm test && rm -rf dist`, `echo $(git push)`) no Sozinho com sandbox → pede (Task 2).
4. Parar tudo com pedidos na fila de outro projeto e um pedido do Time com filhos e consulta em andamento → tudo fecha `cancelled`, nada fica rodando (Task 4).
5. Parar tudo sem nada rodando → botão desabilitado; o atalho não faz nada e não lança (Task 5).

---

### Task 1: Spike — sandbox do Agent SDK no macOS

**Files:**
- Create: `scripts/spike/claude-sandbox.mjs`, `docs/superpowers/spike-sandbox.md`

- [ ] **Step 1:** Script que cria uma pasta temporária com `git init`, roda `query()` com `cwd` nela, `model: 'claude-haiku-5-5'`, `settingSources: []`, `sandbox: { enabled: true, autoAllowBashIfSandboxed: false, failIfUnavailable: false, filesystem: { allowWrite: [cwd], denyWrite: [join(cwd, '.git/hooks'), join(cwd, '.git/config')] } }`, um `canUseTool` que registra cada chamada e permite tudo, e o prompt: `Rode exatamente estes comandos Bash, um por vez, e mostre a saída de cada um: 1) touch dentro.txt 2) touch ~/tutti-sandbox-fora.txt 3) echo x >> .git/config 4) curl -sI https://example.com | head -1`.
- [ ] **Step 2:** Rodar `node scripts/spike/claude-sandbox.mjs`. Registrar: (a) `canUseTool` foi chamado para cada Bash (com `autoAllowBashIfSandboxed: false`)? (b) 1 criou o arquivo, 2 e 3 falharam com erro de permissão, 4 respondeu? (c) `~/tutti-sandbox-fora.txt` não existe depois (apagar se existir). (d) Como saber se o sandbox está ativo na sessão: procurar no `initializationResult()` e nas mensagens `system` o campo que diz isso, e anotar o nome exato (a Task 3 lê esse campo).
- [ ] **Step 3:** Escrever `docs/superpowers/spike-sandbox.md` com o comando, a saída e as respostas (a)–(d). Se (b) falhar (o sandbox não barra a escrita fora), **parar** e levar ao Natan: o desenho do Sozinho para Claude depende disso.
- [ ] **Step 4:** Commit `spike: sandbox do Agent SDK no macOS`.

### Task 2: Política com níveis

**Files:**
- Create: `src/shared/autonomy.ts`
- Modify: `src/main/policy/commandPolicy.ts`
- Test: `tests/shared/autonomy.test.ts`, `tests/main/policy/autonomy.test.ts` (os testes atuais de `commandPolicy` ficam como estão)

**Interfaces:**
- Produces (`src/shared/autonomy.ts`): `type AutonomyLevel = 'ask_all' | 'accept_edits' | 'autonomous'`; `AUTONOMY_LEVELS: readonly AutonomyLevel[]` nessa ordem; `AUTONOMY_LABEL: Record<AutonomyLevel, string>` = `Perguntar tudo` / `Aceitar edições` / `Sozinho`; `DEFAULT_AUTONOMY: AutonomyLevel = 'accept_edits'`; `isAutonomyLevel(x: unknown): x is AutonomyLevel`; `type ApprovalReason = 'ask_all' | 'destructive' | 'outside' | 'network' | 'unknown'`; `APPROVAL_REASON_LABEL: Record<ApprovalReason, string>` = `você pediu para perguntar tudo` / `destrutivo ou irreversível` / `fora do projeto` / `acesso à internet` / `comando que o Tutti não reconhece`.
- Produces (`commandPolicy.ts`): `interface PolicyContext { level: AutonomyLevel; sandboxed: boolean }`; `decide(call: ToolCall, projectDir: string, ctx: PolicyContext): { decision: Decision; reason?: ApprovalReason }` (`reason` só quando `ask`); `isDestructive(command: string): boolean`; `classifyToolCall(call, projectDir)` continua existindo e passa a ser `decide(call, projectDir, { level: 'accept_edits', sandboxed: false }).decision`.

- [ ] **Step 1: Testes que falham** (`tests/main/policy/autonomy.test.ts`, tabela por nível; `P = '/proj'`):

```ts
const d = (call: ToolCall, level: AutonomyLevel, sandboxed = false) => decide(call, P, { level, sandboxed })
const bash = (command: string) => ({ toolName: 'Bash', input: { command } })
const edit = (file_path: string) => ({ toolName: 'Edit', input: { file_path } })

it('ler dentro é livre em todos; fora pede em todos', ...) // Read /proj/a e /etc/x nos 3 níveis
it('Perguntar tudo: edição e comando dentro pedem, com motivo', () => {
  expect(d(edit('/proj/a.ts'), 'ask_all')).toEqual({ decision: 'ask', reason: 'ask_all' })
  expect(d(bash('ls'), 'ask_all')).toEqual({ decision: 'ask', reason: 'ask_all' })
})
it('Aceitar edições = regra de hoje', () => {
  expect(d(edit('/proj/a.ts'), 'accept_edits').decision).toBe('allow')
  expect(d(bash('npm test'), 'accept_edits').decision).toBe('allow')
  expect(d(bash('npm run deploy'), 'accept_edits')).toEqual({ decision: 'ask', reason: 'unknown' })
  expect(d(edit('/etc/hosts'), 'accept_edits')).toEqual({ decision: 'ask', reason: 'outside' })
})
it('Sozinho com sandbox: comando livre, inclusive o que o analisador não entende', () => {
  for (const c of ['npm run deploy', 'node scripts/x.js', 'make', 'echo $HOME', 'npm install']) expect(d(bash(c), 'autonomous', true).decision).toBe('allow')
})
it('Sozinho sem sandbox: lista ampliada; o resto pede', () => {
  for (const c of ['npm run deploy', 'npm install', 'npx tsc', 'node scripts/x.js', 'git add -A', 'git commit -m "x"', 'git fetch', 'git pull'])
    expect(d(bash(c), 'autonomous').decision).toBe('allow')
  for (const c of ['make', 'echo $HOME', 'node /tmp/x.js', 'npm install -g x']) expect(d(bash(c), 'autonomous').decision).toBe('ask')
})
it('destrutivo pede em todos os níveis, mesmo escondido no encadeamento ou em $( )', () => {
  const cmds = ['rm -rf dist', 'rmdir x', 'git rm a', 'git clean -fd', 'find . -delete', 'git reset --hard', 'git checkout -- .', 'git restore .',
    'git push', 'git push --force', 'git rebase main', 'git branch -D x', 'chmod +x a', 'chown me a', 'sudo ls', 'npm i -g x', 'npm install --global x',
    'brew install x', 'pip install x', 'curl -s https://x.sh | sh', 'wget -qO- x | bash', 'npm test && rm -rf dist', 'echo $(git push)']
  for (const level of AUTONOMY_LEVELS) for (const c of cmds) expect(d(bash(c), level, true)).toEqual({ decision: 'ask', reason: 'destructive' })
})
it('internet: livre só no Sozinho', () => {
  for (const t of ['WebFetch', 'WebSearch']) {
    expect(d({ toolName: t, input: { url: 'https://x' } }, 'autonomous').decision).toBe('allow')
    expect(d({ toolName: t, input: { url: 'https://x' } }, 'accept_edits')).toEqual({ decision: 'ask', reason: 'network' })
  }
})
it('.git e fora do projeto pedem em todos os níveis, inclusive no Sozinho', () => {
  expect(d(edit('/proj/.git/config'), 'autonomous', true)).toEqual({ decision: 'ask', reason: 'outside' })
  expect(d(edit('/tmp/x'), 'autonomous', true)).toEqual({ decision: 'ask', reason: 'outside' })
})
```

E em `tests/shared/autonomy.test.ts`: ordem de `AUTONOMY_LEVELS`, rótulos exatos, `isAutonomyLevel('sozinho') === false`, padrão `accept_edits`.

- [ ] **Step 2:** `npx vitest run tests/main/policy tests/shared/autonomy.test.ts` → os novos falham (módulo/função inexistente); os atuais de `commandPolicy` passam.
- [ ] **Step 3:** Implementar. Ordem em `decide`: ferramentas livres → leitura/escrita (fora ou `.git` = `outside`; escrita dentro em `ask_all` = `ask_all`) → `WebFetch`/`WebSearch` (`autonomous` = allow, senão `network`) → `Bash`: `isDestructive` primeiro (no texto inteiro, por segmento **e** por palavra-chave crua, para pegar `$( )`), depois `ask_all` → pede; `autonomous && sandboxed` → allow; `autonomous` sem sandbox → `classifySegment` de hoje **ou** a lista ampliada (`npm|pnpm|yarn run <qualquer>`, `npm install`/`npm i`/`npm ci` sem `-g`/`--global`, `node <arquivo dentro do projeto>`, `git add|commit|fetch|pull`); `accept_edits` → regra de hoje. Motivo de `ask` sem outro motivo = `outside` se algum caminho está fora, senão `unknown`. Qualquer outra ferramenta → `unknown`.
- [ ] **Step 4:** `npx vitest run tests/main/policy tests/shared/autonomy.test.ts` → PASS; suíte inteira verde.
- [ ] **Step 5:** Commit `feat(autonomia): política com três níveis e destrutivos`.

### Task 3: Nível por projeto até os adaptadores

**Files:**
- Modify: `src/main/adapters/types.ts`, `src/main/adapters/claude.ts`, `src/main/adapters/opencode.ts`, `src/main/runs/runService.ts`, `src/shared/events.ts` (`approval_request.reason?`), `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/models.ts`, `src/main/index.ts`
- Test: `tests/main/adapters/claude.test.ts`, `tests/main/adapters/opencode.test.ts`, `tests/main/runs/runService.autonomy.test.ts`

**Interfaces:**
- Consumes: Task 2 (`decide`, `AutonomyLevel`, `ApprovalReason`), nome do campo de sandbox ativo da Task 1.
- Produces:
  - `AdapterRunOptions.autonomy?: () => AutonomyLevel` (lido a cada permissão; ausente = `accept_edits`) e `AdapterRunOptions.sandbox?: boolean` (só o Claude usa).
  - `requestApproval(req: { toolName: string; summary: string; reason?: ApprovalReason })`; evento `{ type: 'approval_request'; id; toolName; summary; reason?: ApprovalReason }`.
  - `RunService` dep `autonomyFor?: (projectPath: string) => AutonomyLevel`.
  - IPC/preload: `autonomy(projectPath: string): Promise<AutonomyLevel>`, `setAutonomy(projectPath: string, level: AutonomyLevel): Promise<void>` (main valida caminho absoluto e `isAutonomyLevel`; grava `autonomy:<caminho>`).

- [ ] **Step 1: Testes que falham:**
  - `buildClaudeOptions` com `sandbox: true` → `options.sandbox` = `{ enabled: true, autoAllowBashIfSandboxed: false, failIfUnavailable: false, filesystem: { allowWrite: [cwd], denyWrite: [cwd/.git/hooks, cwd/.git/config] } }`; sem `sandbox` → sem a chave.
  - `makeCanUseTool`: com `autonomy: () => 'ask_all'`, `Edit` dentro pede e o `requestApproval` recebe `reason: 'ask_all'`; trocando o retorno do getter para `'accept_edits'` entre duas chamadas, a segunda é livre (Review Focus 1); com `autonomy: () => 'autonomous'` e **sem** `sandbox`, `Bash npm run deploy` pede (age como Aceitar edições, Review Focus 2); com `sandbox: true`, é livre.
  - opencode `answerPermission`: com `'autonomous'`, `webfetch` responde `once` sem chamar `requestApproval`; com `'accept_edits'`, pede com `reason: 'network'`; `shell` com `npm run deploy` no Sozinho → `once` (lista ampliada).
  - `runService.autonomy.test.ts`: `autonomyFor` devolvendo `'autonomous'` → o adaptador de um agente Claude CLI recebe `sandbox: true`; o de um agente opencode recebe `sandbox` ausente; em `mode: 'consult'` nada de `sandbox`; `autonomy()` do adaptador reflete mudança feita depois de o pedido começar.
- [ ] **Step 2:** `npx vitest run tests/main/adapters tests/main/runs` → os novos falham.
- [ ] **Step 3:** Implementar.
  - Claude: `sandbox` entra em `buildClaudeOptions` como no teste. `canUseTool` usa `decide(call, cwd, { level: effective, sandboxed })`, com `effective = level === 'autonomous' && !sandboxed ? 'accept_edits' : level`. `sandboxed` = `opts.sandbox` e o que a sessão informar sobre o sandbox ativo (campo da Task 1): se vier inativo, gravar um evento `notice` "Sozinho indisponível: usando Aceitar edições" uma vez e tratar como `false`.
  - opencode: `decide` com `sandboxed: false`.
  - `runService.execute`: `level = this.deps.autonomyFor?.(input.projectPath) ?? 'accept_edits'` na hora; `sandbox = mode !== 'consult' && level === 'autonomous' && agent.transport.kind === 'cli' && agent.tool === 'claude'`; `autonomy: () => this.deps.autonomyFor?.(input.projectPath) ?? 'accept_edits'`. `requestApproval` grava `reason` no evento.
  - `index.ts`: `autonomyFor = p => { const v = store.getSetting('autonomy:' + p); return isAutonomyLevel(v) ? v : DEFAULT_AUTONOMY }`.
- [ ] **Step 4:** Mesmo comando → PASS; `npx tsc -b` e suíte inteira verdes.
- [ ] **Step 5:** Commit `feat(autonomia): nível por projeto nos agentes; Sozinho com sandbox no Claude`.

### Task 4: Parar tudo no processo principal

**Files:**
- Modify: `src/main/runs/runService.ts`, `src/main/skills/skillIpc.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/models.ts`
- Test: `tests/main/runs/stopAll.test.ts`, `tests/main/skills/skillIpc.test.ts`

**Interfaces:**
- Produces:
  - `RunService.cancelAll(): number` (aborta todos os controladores, inclusive fila; devolve quantos); `RunService.activeCount(): number`; dep `onActivity?: (active: number) => void`, chamada quando um controlador entra ou sai.
  - `skillHandlers(svc)` ganha `cancelAllSkills(): void` (aborta todos os `running`).
  - IPC/preload: `stopAll(): Promise<void>` (= `runs.cancelAll()` + `cancelAllSkills()`); canal `activity` → `onActivity(cb: (active: number) => void): () => void` e `activity(): Promise<number>`.

- [ ] **Step 1: Testes que falham** (`stopAll.test.ts`, com o mesmo `setup` de repositório git temporário e adaptador falso dos testes de `runService`):
  - Dois projetos: um pedido rodando em cada e um segundo pedido na fila do primeiro → `cancelAll()` devolve 3; depois de `whenFinished`, os três estão `cancelled`; o da fila nunca chamou o adaptador; os que rodavam mostram o diff do que já tinham escrito (evento `diff` com o arquivo escrito antes do cancelamento).
  - Pedido do Time (`TeamService` com cérebro falso que espera o sinal) → `cancelAll()` fecha o pai e os filhos `cancelled` e o cérebro recebeu o abort (Review Focus 4).
  - Aprovação pendente → `approval_resolved allowed:false`; aviso de limite pendente → `limit_resolved pass:false`.
  - `onActivity` recebe 1, 2 … e termina em 0; `cancelAll()` sem nada rodando devolve 0 e não lança.
  - `skillIpc`: duas execuções de skill pendentes → `cancelAllSkills()` → as duas devolvem `{ ok: false, error: 'CANCELED' }`.
- [ ] **Step 2:** `npx vitest run tests/main/runs/stopAll.test.ts tests/main/skills/skillIpc.test.ts` → falham.
- [ ] **Step 3:** Implementar. `onActivity` chamado em `controllers.set` / `controllers.delete`. `index.ts` liga `onActivity` a `win.webContents.send('activity', n)`.
- [ ] **Step 4:** Mesmo comando → PASS; suíte inteira verde.
- [ ] **Step 5:** Commit `feat: parar tudo no processo principal`.

### Task 5: Interface — seletor de autonomia, motivo da aprovação e Parar tudo

**Files:**
- Create: `src/renderer/components/AutonomyPicker.tsx`, `src/renderer/components/StopAllButton.tsx`
- Modify: `src/renderer/components/Composer.tsx`, `src/renderer/components/ApprovalCard.tsx`, `src/renderer/state/chat.ts` (`Approval.reason?`), `src/renderer/App.tsx`, `src/renderer/styles.css`
- Test: `tests/renderer/autonomy.test.tsx`

**Interfaces:**
- Consumes: Task 3 (`autonomy`, `setAutonomy`, `reason` no evento), Task 4 (`stopAll`, `activity`, `onActivity`).

- [ ] **Step 1: Testes que falham:**
  - `AutonomyPicker` com projeto aberto mostra os três rótulos exatos, marca o que `window.time.autonomy('/proj')` devolveu e, ao clicar em `Sozinho`, chama `setAutonomy('/proj', 'autonomous')` e o botão ganha a classe `alert`. Sem projeto: desabilitado.
  - `ApprovalCard` com `reason: 'destructive'` mostra `Pede sua aprovação · destrutivo ou irreversível`; sem `reason`, o texto de hoje.
  - `chat.ts`: `approval_request` com `reason` guarda o motivo.
  - `StopAllButton`: com `activity` 0 fica desabilitado; `onActivity(2)` habilita; clicar chama `stopAll` uma vez; ⌘ + . (`keydown` com `metaKey` e `key: '.'`) chama `stopAll`; com 0 ativo, o atalho não chama (Review Focus 5).
- [ ] **Step 2:** `npx vitest run tests/renderer/autonomy.test.tsx` → falha.
- [ ] **Step 3:** Implementar. `AutonomyPicker` no rodapé do composer (`.hint`, à esquerda do "Enter envia"), três botões segmentados; `StopAllButton` (■ Parar tudo) em `.pickers` no cabeçalho, com o listener de teclado registrado no `window` enquanto montado.
- [ ] **Step 4:** Mesmo comando → PASS; `npx tsc -b` e suíte inteira verdes.
- [ ] **Step 5:** Commit `feat: seletor de autonomia, motivo da aprovação e Parar tudo`.

### Task 6: Verificação no app

**Files:**
- Create: `scripts/e2e/verify-autonomia.mjs`, prints em `docs/superpowers/verificacao-autonomia/`

- [ ] **Step 1:** Script Playwright (padrão de `verify-skills.mjs`, repositório temporário com `git init`):
  1. Nível **Sozinho** no projeto; pedir ao **Forja**: "Rode `node -e \"require('fs').writeFileSync('ok.txt','1')\"` e depois `touch ~/tutti-e2e-fora.txt`; me diga o resultado de cada um." → `ok.txt` existe, `~/tutti-e2e-fora.txt` **não** existe (apagar se existir e marcar FALHOU), nenhum cartão de aprovação para o primeiro.
  2. Ainda em Sozinho: "Rode `rm -f ok.txt`." → aparece cartão com "destrutivo ou irreversível"; Negar.
  3. Nível **Perguntar tudo**: "Crie o arquivo b.txt com o texto oi." → cartão com "você pediu para perguntar tudo".
  4. **Parar tudo:** pedir ao Forja "Rode `sleep 60` e depois diga ok." em Sozinho; após 5 s clicar em ■; o pedido fecha "cancelado" em até 10 s; `pgrep -f "sleep 60"` vazio; o botão volta a ficar desabilitado.
- [ ] **Step 2:** `npm run build && node scripts/e2e/verify-autonomia.mjs docs/superpowers/verificacao-autonomia` → `OK` em cada etapa.
- [ ] **Step 3:** Commit `test(e2e): verificação da autonomia e do Parar tudo`.
