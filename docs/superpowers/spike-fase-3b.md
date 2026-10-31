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
