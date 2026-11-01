# Spike — perfis e modo API (opencode 2.2.5)

Scripts: `scripts/spike/opencode-api.mjs`, `scripts/spike/opencode-nokey.mjs`. Nenhuma chave real foi usada.

**(a) Chave do provedor:** `OPENCODE_CONFIG_CONTENT` com `{ provider: { <id>: { options: { apiKey } } } }` funciona; o provedor aparece como `activation: "enabled"`. Provedor declarado **sem** chave (`{ provider: { openai: {} } }`) também aparece e lista os modelos. Então o app declara os seis sempre e só coloca `apiKey` onde há chave salva.

**(b) Ids dos provedores:** `openrouter` (OpenRouter), `moonshotai` (Moonshot AI / Kimi), `openai`, `anthropic`, `google`, `deepseek`. Todos existem no 2.2.5.

**(c) Modelos:** `GET /api/model` → `data[]` com `providerID`, `modelID`, `name`, `cost`, `limit`, `capabilities`. Em 2026-11-01: OpenRouter 351, OpenAI 79, Google 22, Anthropic 20, Moonshot 6, DeepSeek 2. Os ids do OpenRouter levam o prefixo do dono (`moonshotai/kimi-k3.1-pro`). Sessão aceita `model: { providerID: 'openrouter', id: 'moonshotai/kimi-k3.1-pro' }`.

**Cuidado:** `GET /api/provider` e `GET /api/model` devolvem `settings.apiKey` em texto puro. O servidor só escuta em 127.0.0.1 com senha, mas o app **nunca** repassa essas respostas para a interface: a listagem de modelos para o renderer leva só `{ id, name }`.

**(d) Chave inválida/ausente:** `session.step.failed` e `session.execution.failed` com `error: { type: 'provider.auth', message: 'Missing Authentication header', status: 401 }`. A sessão termina (não trava).

**(e) Tokens:** com a chave inválida não houve passo concluído; a forma dos tokens (`session.step.ended.tokens`) é a mesma do modelo gratuito pelo motor, mas a confirmação com modelo pago fica para o teste manual do Natan com a chave dele.

## Verificação no app (2026-11-01)
`scripts/e2e/verify-perfis.mjs` e `scripts/e2e/verify-perfis-palco.mjs` no app real (pasta descartável `time-teste-fase1`); prints em `docs/superpowers/verificacao-perfis/`. Os perfis de teste e a chave falsa são apagados no fim.

| Passo | Resultado |
|---|---|
| 1 Duplicar | "Padrão (cópia)" aparece no seletor com os 6 mascotes; o projeto lembra o perfil; outro projeto continua no Padrão |
| 2 Do zero | "Duo" com Claudinho (CLI Claude), Kimi (API OpenRouter) e Nuvem (Codex, só lê), sem coordenador: chips só dos três, sem "Time"; Kimi travado com "Sem chave da OpenRouter" e rótulo "OpenRouter · API"; aviso "cobrado pelo provedor" no formulário |
| 3 Contexto | Claudinho: "Manga" → Nuvem, perguntado depois: "Manga" |
| 4 Chave falsa | `sk-or-teste-invalida` salva → Kimi liberado; pedido termina "parou com erro" com "Missing Authentication header"; remover a chave → Kimi travado de novo |
| 5 Plano pago | **Não verificado no app:** com chave falsa o Kimi não confirma na triagem, então o coordenador não o escala. Coberto pelos testes (`escalação com agente por API paga exige aprovação…`, `passo pago tem selo no plano`). Fica para o Natan com a chave real |
| Console | sem erros |

Achados que viraram correção: salvar/remover chave não atualizava a disponibilidade; rótulo do agente API mostrava "opencode"; painel de uso por cima da tela de perfis; com 3 agentes a câmera aproximava e o painel cobria o nome do último; conversa antiga de perfil apagado mostrava "Agente (removido)" em vez do nome; caixas de marcar e campo de modelo espremidos pelo CSS do painel.

## Revisão final: chave fora do env
`scripts/spike/opencode-env-leak.mjs`: o opencode 2.2.5 lê `opencode.json` dentro de `OPENCODE_CONFIG_DIR` (`/api/provider` mostrou a chave falsa do arquivo). O app passou a gravar as chaves ali (arquivo 0600, apagado quando o servidor sai) em vez de `OPENCODE_CONFIG_CONTENT`, porque comandos rodados pelo opencode herdariam o env do servidor. O teste de herança em si ficou inconclusivo (o modelo gratuito não rodou o comando); a troca vale de qualquer forma.
