# Spike de uso e limites — resultados (2026-11-01)

## Claude Code — ✅ limite oficial
- **Durante o pedido:** `rate_limit_event.rate_limit_info.unifiedWindows` traz as janelas de uma vez: `five_hour {utilization 0–1, resetsAt (s)}` e `seven_day {utilization, resetsAt, surpassedThreshold}`; o topo do evento repete a janela que motivou o aviso (`rateLimitType`, `utilization` 0–1).
- **Tokens:** `result.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens_details.thinking_tokens`).
- **Sem pedido, custo zero:** `query()` com `prompt` em stream que nunca manda mensagem + `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })` → `rate_limits.five_hour/seven_day {utilization 0–100, resets_at ISO}` em ~0,5 s, `session.total_cost_usd: 0`. Depois da mensagem `result` a chamada falha ("Query closed"). API marcada como experimental — tratar falha como "sem dado".
- Plano do Natan: `subscription_type: "pro"`.

## Codex — ✅ limite pelos logs locais
- O SDK só entrega tokens (`turn.completed.usage`).
- O CLI grava em `~/.codex/sessions/AAAA/MM/DD/rollout-…-<thread_id>.jsonl` linhas com `"rate_limits": { primary: { used_percent, window_minutes: 300, resets_at (s) }, secondary: { used_percent, window_minutes: 10080, resets_at } }`. Depois de cada turno, ler a última ocorrência no arquivo da thread. `primary` = 5 h, `secondary` = semanal.

## Antigravity — tokens apenas
- `step_update.usage {input_tokens, output_tokens, thinking_tokens, cache_read_tokens, total_tokens}` por passo `agent_response`. Nenhum campo de cota → linha "estimado" (teto configurável) ou "—".

## opencode — tokens apenas
- `session.step.ended.tokens {input, output, reasoning, cache: {read, write}}` e `cost: 0` (modelos gratuitos). Sem limite.
