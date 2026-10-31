# Spike da Fase 3A — resultados (2026-10-31)

## Radar — Antigravity CLI (`agy` 1.4.11, `~/.local/bin/agy`) — ✅
- Autentica pelo login do Natan (`~/.gemini/antigravity-cli/antigravity-oauth-token`), sem chave de API.
- `agy -p <prompt> --output-format stream-json --mode plan --disable-slash-commands`:
  - lê arquivos (`read_file`) e pesquisa na web (`search_web`);
  - **bloqueia** escrita no projeto (`write_file` → `state:'ERROR'`) e comandos (`run_command` → `ERROR`); nada é criado.
  - o modo `plan` grava o próprio plano em `~/.gemini/antigravity-cli/brain/…` (pasta interna do agy, fora do projeto) — aceitável.
- Eventos (NDJSON): `{event:'init', conversation_id, init:{cwd, tools[]}}`, `{event:'step_update', step_update:{step_index, state:'ACTIVE'|'DONE'|'ERROR', step_type:'user_input'|'agent_response'|'tool', text_delta?, tool_name?, tool_info:{name, parameters}}}`, `{event:'result', result:{conversation_id, status:'SUCCESS', response}}`. Fixtures: `tests/main/adapters/fixtures/agy-plan-readonly.jsonl`, `agy-command-blocked.jsonl`.
- Retomar: `--conversation <conversation_id>` mantém o contexto (respondeu `hello.txt`).
- Plugins: nenhum instalado; `~/.gemini/config/mcp_config.json` vazio. Passamos `--disable-slash-commands`; sem `--settings` por ora.

## Curinga — opencode 2.2.5 (`~/.opencode/bin/opencode`, fora do PATH) — ✅ com API própria
- Sem login em provedor; usa modelos gratuitos `opencode/*` (ex.: `opencode/big-pickle`) — sem cobrança.
- **O SDK `@opencode-ai/sdk` 1.19.5 do npm não serve para o CLI 2.x**: o servidor imprime `Server listening on <url>` (o SDK espera outro texto) e a API mudou para `/api/...`. Decisão: o app sobe `opencode serve --hostname=127.0.0.1 --port=0` com `OPENCODE_SERVER_PASSWORD` aleatória e fala HTTP direto (Basic `opencode:<senha>`). SDK removido das dependências.
- Rotas usadas: `POST /api/session` `{title, location:{directory}, model:{providerID:'opencode', id}, permissions:[{action, resource:'*', effect}]}` → `{data:{id,…}}`; `POST /api/session/{id}/prompt` `{text}`; `GET /api/event` (SSE, `data:` com JSON `{id, type, data:{sessionID,…}}`); `POST /api/session/{id}/permission/{requestID}/reply` `{decision:'once'|'always'|'reject', message?}`; `POST /api/session/{id}/interrupt`.
- **Ação de comando é `shell`** (não `bash`): com `{action:'shell', effect:'ask'}` chega `permission.asked {id, sessionID, action:'shell', resources:['npm install left-pad']}`; `reject` é respeitado (`session.tool.failed` com `permission.rejected`). Com `bash` a regra é ignorada e o comando roda — cuidado.
- Eventos úteis: `session.tool.called {id, input}`, `session.tool.success|failed`, `session.text.ended {text}`, `session.execution.succeeded|failed`, `permission.asked|replied`. Fixture: `tests/main/adapters/fixtures/opencode-events.json`.
- `kill SIGTERM` no `opencode serve` encerra sem órfãos.

## Pergunta do Claude (`AskUserQuestion`) — ✅
- `input`: `{questions:[{question, header, options:[{label, description}], multiSelect}]}`.
- Resposta: `canUseTool` devolve `{behavior:'allow', updatedInput:{...input, answers:{[question]: resposta}}}`; o Claude seguiu a resposta (criou `resposta-teste.txt`).

## Verificação no app (Task 7) — 2026-10-31

`scripts/e2e/verify-fase3a.mjs` no app real; prints em `docs/superpowers/verificacao-fase-3a/`.

| Passo | Resultado |
|---|---|
| 1. Elenco completo | ✅ Radar e Curinga liberados (CLIs detectados), sem erros no console |
| 2. Radar pesquisa | ✅ `idle → thinking → working → done`; respondeu com link da fonte; `git status` inalterado |
| 3. Curinga | ✅ criou `src/mult.js` sem perguntar; pediu aprovação de `npm install left-pad 2>&1 \| tail -20` (comando inteiro, com o pipe); negado → `package.json` intacto |
| 4. Conversa contínua | ✅ Forja respondeu o caminho do arquivo que criou no pedido anterior |
| 5. Pergunta | ✅ cartão com opções e campo livre; mascote em `waiting` com "Tenho uma pergunta"; resposta `pergunta-ok.js` → arquivo criado com esse nome |
| 6. Cancelar o Radar | ✅ processo `agy` encerrado em até 3 s |
| 7. Fechar o app | ✅ `opencode serve` encerrado em até 6 s, sem órfão |
