# Spike da Fase 1 — resultados (2026-10-31)

## 1. Claude Agent SDK 0.3.314 — ✅ sim
- Rodou pela **assinatura**: `init.apiKeySource = "none"`, `model = claude-sonnet-5-5`, `result success`, `hello.txt` criado.
- Com `settingSources: []`, `strictMcpConfig`, `mcpServers: {}`, `plugins: []`: **nenhum plugin/MCP do Natan** carregado. Só plugins embutidos (`cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring`, origem `builtin`) e as skills embutidas do Claude Code.
  - Decisão: passar também `skills: []` no adaptador para desligar skills embutidas.
  - Observação: a lista de ferramentas do spike incluiu ferramentas do ambiente desktop (Artifact, Cron…, ScheduleWakeup) porque o spike rodou dentro de uma sessão do app Claude, herdando o `env`. No adaptador, remover do `env` filho as variáveis `CLAUDE_CODE_*` / `CLAUDECODE` herdadas, além de `ANTHROPIC_API_KEY`.
- `canUseTool` **foi chamado para `Write`**, **não** para `Bash ls`: no `permissionMode: 'default'` a própria CLI libera comandos só-leitura sem perguntar. Isso é compatível com a política (leitura = liberado). Comandos fora da lista de leitura da CLI chegam ao `canUseTool`, onde aplicamos `classifyToolCall`.
- Formato observado: `assistant.message.content[]` com blocos `text` e `tool_use {name, input}`; `result {subtype:'success', session_id, is_error}`; outras mensagens (`user`, `rate_limit_event`, `system/task_summary`, `system/post_turn_summary`) são ignoradas.

## 2. Codex SDK 0.166.0 — ✅ sim
- Rodou pela assinatura com `OPENAI_API_KEY` removida; `config: { mcp_servers: {} }` foi aceito.
- `sandboxMode: 'read-only'` + `approvalPolicy: 'never'`: a tentativa de criar `x.txt` foi **negada**; `x.txt` não existe.
- Eventos: `thread.started {thread_id}`, `turn.started`, `item.started|completed` com `item.type` = `agent_message {text}` | `command_execution {command, aggregated_output, exit_code, status}`; `turn.completed {usage}`. O `command` vem embrulhado: `/bin/zsh -lc "<cmd>"` — o adaptador deve desembrulhar para o resumo.
- `thread.id` disponível após o run (para retomar).
- Atenção: existe `~/.codex/hooks.json` do Natan; o SDK pode executá-lo. Fica registrado para a Fase 3 (não bloqueia o Lupa só-leitura).

## 3. SQLite no Electron — ✅ `node:sqlite`
- Electron 45.2.0 com Node 24.22.1: `DatabaseSync` funcionou. **Decisão: `node:sqlite`**, sem `better-sqlite3`.

## Modelos
- Claude: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`.
- Codex: padrão da config do Natan (`codex -m` aceita outro).

## Não instalados (Fase 3)
- Gemini CLI, opencode.

## Verificação no app (Task 11) — 2026-10-31

Rodada automatizada com Playwright dirigindo o app Electron real (`scripts/e2e/verify-fase1.mjs`) na pasta descartável `~/Documents/www/projects/time-teste-fase1`. Prints em `docs/superpowers/verificacao-fase-1/`.

| Passo | Resultado |
|---|---|
| 2. Forja cria `src/soma.js` e roda `npm test` | ✅ sem pedir aprovação; diff mostra `A src/soma.js` |
| 3. Pincel tenta `npm install left-pad`, Natan nega | ✅ card de aprovação apareceu; `package.json` inalterado; agente respondeu que não instalou |
| 4. Forja altera `soma`; Natan edita outra linha **depois** do pedido; Desfazer | ✅ mudança do agente revertida, edição do Natan mantida |
| 5. Lupa revisa `src/soma.js` | ✅ resposta em PT-BR; nenhum arquivo alterado |
| 6. Fechar o app no meio de um pedido e reabrir | ✅ card "interrompido (app fechado)" |

Bugs achados e corrigidos na verificação:
- `npm test 2>&1 | tail -30` pedia aprovação → política ignora redirecionamentos inofensivos.
- Conversa reaberta mostrava pedido interrompido como "trabalhando" → status vem do banco.

Limitações confirmadas:
- **Edição do Natan feita DURANTE um pedido** entra no ponto de restauração final e o Desfazer reverte junto (diff do agente incluiu a linha do Natan). Edições feitas **depois** do pedido são preservadas.
- Em arquivos pequenos, qualquer edição do Natan perto do trecho do agente vira conflito: o app avisa e não mexe em nada (comportamento seguro).

## Verificação da Fase 2 (palco 3D) — 2026-10-31

Script `scripts/e2e/verify-fase2.mjs` dirigindo o app real; prints em `docs/superpowers/verificacao-fase-2/`.

| Passo | Resultado |
|---|---|
| 1. Palco parado | ✅ 1 canvas WebGL, 6 rótulos, Radar e Curinga `locked`, nenhum erro no console |
| 2. Clique no mascote | ✅ Pincel selecionado; clicar no Radar não muda a aba |
| 3. Pedido ao Forja | ✅ `idle → thinking → working → done → idle`; balão "Editando src/div.js" |
| 4. Pincel pede aprovação | ✅ pose `waiting` com balão "Preciso da sua aprovação: npm install left-pad"; após negar, `done` |
| 5. Janela estreita (palco 668 px) | ✅ seis rótulos dentro do palco, sem sobreposição |
| 6. Desempenho | ✅ 60 fps com o palco parado |

Ajustes feitos a partir dos prints: rótulo da Bússola sumia (drei `<Html>` sem pai no 1º quadro → camada própria via `portal`); braço da Bússola cortado na borda (margem da câmera 0.4 → 1.2); rótulos sobre as pernas (descidos para y −1.25).
