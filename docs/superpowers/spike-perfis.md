# Spike — perfis e modo API (opencode 2.2.5)

Scripts: `scripts/spike/opencode-api.mjs`, `scripts/spike/opencode-nokey.mjs`. Nenhuma chave real foi usada.

**(a) Chave do provedor:** `OPENCODE_CONFIG_CONTENT` com `{ provider: { <id>: { options: { apiKey } } } }` funciona; o provedor aparece como `activation: "enabled"`. Provedor declarado **sem** chave (`{ provider: { openai: {} } }`) também aparece e lista os modelos. Então o app declara os seis sempre e só coloca `apiKey` onde há chave salva.

**(b) Ids dos provedores:** `openrouter` (OpenRouter), `moonshotai` (Moonshot AI / Kimi), `openai`, `anthropic`, `google`, `deepseek`. Todos existem no 2.2.5.

**(c) Modelos:** `GET /api/model` → `data[]` com `providerID`, `modelID`, `name`, `cost`, `limit`, `capabilities`. Em 2026-11-01: OpenRouter 351, OpenAI 79, Google 22, Anthropic 20, Moonshot 6, DeepSeek 2. Os ids do OpenRouter levam o prefixo do dono (`moonshotai/kimi-k3.1-pro`). Sessão aceita `model: { providerID: 'openrouter', id: 'moonshotai/kimi-k3.1-pro' }`.

**Cuidado:** `GET /api/provider` e `GET /api/model` devolvem `settings.apiKey` em texto puro. O servidor só escuta em 127.0.0.1 com senha, mas o app **nunca** repassa essas respostas para a interface: a listagem de modelos para o renderer leva só `{ id, name }`.

**(d) Chave inválida/ausente:** `session.step.failed` e `session.execution.failed` com `error: { type: 'provider.auth', message: 'Missing Authentication header', status: 401 }`. A sessão termina (não trava).

**(e) Tokens:** com a chave inválida não houve passo concluído; a forma dos tokens (`session.step.ended.tokens`) é a mesma do modelo gratuito pelo motor, mas a confirmação com modelo pago fica para o teste manual do Natan com a chave dele.
