# Spike da Fase 3B — resultados (2026-10-31)

## JSON por esquema (`outputFormat: { type: 'json_schema', schema }`) — ✅
- `claude-sonnet-5-5`, sem ferramentas (`disallowedTools` com todas), 4,4 s.
- O objeto validado vem em `result.structured_output` (mensagem `result`, `subtype: 'success'`). Falha esperada: `subtype: 'error_max_structured_output_retries'`.
- O esquema precisa de `additionalProperties: false` e `required` em cada objeto.

## Ferramenta própria (MCP in-process) — ✅
- `createSdkMcpServer({ name: 'tutti', tools: [tool('perguntar_ao_time', desc, { agente: z.enum(['radar','lupa']), pergunta: z.string() }, handler)] })` em `mcpServers: { tutti }`, com `strictMcpConfig: true`.
- Nome final: **`mcp__tutti__perguntar_ao_time`**. O Claude Code a trata como ferramenta sob demanda: chama `ToolSearch` (`select:mcp__tutti__perguntar_ao_time`) antes — `ToolSearch` precisa estar liberado.
- `canUseTool` **é chamado** para a ferramenta MCP → liberar explicitamente.
- `zod` 4.6.7 fixado como dependência (peer do SDK).

## Verificação no app (Task 9) — 2026-10-31

`scripts/e2e/verify-fase3b.mjs` (e `verify-fase3b-cancel.mjs`) no app real; prints em `docs/superpowers/verificacao-fase-3b/`.

| Passo | Resultado |
|---|---|
| 1. Pedido de time (endpoint + página) | ✅ rodada com 6 barras; 3 candidatos confirmaram com frase própria; escalação Forja `server/health.js` + Pincel `web/status.html` na **mesma onda**, Lupa depois. Banco: Forja +15,7 s→+25,8 s e Pincel +15,8 s→+21,4 s (sobrepostos); Lupa +25,8 s→+43,5 s. Pedido inteiro 43,8 s. |
| 3. Fila | ✅ segundo pedido mostrou "Na fila (posição 1)" e começou sozinho depois (criou `web/sobre.html`) |
| 2. Plano recusado ("forçar plano") | ✅ PlanCard; Bússola `waiting` com "Aprova o plano?"; Recusar → nada alterado |
| 4. Forja pergunta ao Radar | ✅ "→ perguntou ao Radar … ← resposta" no chat; Radar `working` com "Respondendo ao Forja" no palco |
| 5. Cancelar | ⚠️ parcial no app: cancelamento durante a triagem fechou o pedido (`cancelled`, 0,7 s). O caso "com dois filhos rodando" não foi reproduzido no app (na 2ª tentativa o Bússola escalou só Forja e Lupa, em sequência); está coberto pelos testes do TeamService (`cancelar durante onda`). |

Achado e corrigido na verificação: a 1ª rodada travou porque os filhos pediram aprovação de `mkdir -p` e `node -e` e ninguém respondia; `mkdir` dentro do projeto passou a ser liberado (fora do projeto ou em `.git`, pergunta). `node -e` continua pedindo (é execução de código).

Custo observado de um pedido de time: 2 chamadas do Bússola (sonnet) + 2–3 confirmações (haiku) + o trabalho dos agentes + revisão do Lupa.
