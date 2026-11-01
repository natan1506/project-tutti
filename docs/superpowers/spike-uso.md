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

## Verificação no app (2026-11-01)
`scripts/e2e/verify-uso.mjs` dirigindo o app real na pasta descartável `time-teste-fase1`; prints em `docs/superpowers/verificacao-uso/`.

| Passo | Resultado |
|---|---|
| 1 Painel | 4 linhas no canto inferior direito; Claude com % real desde a abertura (consulta sem pedido), demais "—" |
| 2 Tokens | Claude e Antigravity sobem ao fim de cada pedido; opencode sobe com o Curinga |
| 3 Contexto | Forja: "Azul" → Radar, perguntado depois, respondeu "Azul" |
| 4 Gatilho | Aviso no meio do pedido com destino Curinga; [Passar] → Forja "cancelado", nota "Trabalho passado para o Curinga", Curinga refez o `sleep 45` e terminou. Confirmado por print (`passo4c-passado.png`) e pelo banco; a asserção do script lia o lugar errado e foi corrigida depois, sem nova rodada para poupar cota |
| Console | sem erros |

Achados que viraram correção:
- O painel a `bottom: 150px` cobria os nomes da Lupa e do Curinga e a camada dos nomes roubava o clique. Agora fica na altura do compositor, acima da camada; em palco estreito o compositor encosta à esquerda.
- Campo "avisar em" da ferramenta apagado não voltava ao geral (o valor vazio era descartado e o antigo ficava). Agora `null` apaga o ajuste.
- Aviso de um pedido que terminou antes da resposta ficava com os botões abertos. Agora o fim do pedido fecha o aviso como "Seguiu como estava".
- Um pedido que pede aprovação de comando (o Curinga quis rodar `find` com `-prune`) fica parado esperando o Natan, como manda a política; não é falha da passagem.

Observação real: o Claude do Natan está em ~90% do limite **semanal**, então com o "avisar em" padrão (90%) os avisos já aparecem de verdade.
