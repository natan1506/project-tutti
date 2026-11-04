# Spike — sandbox do Agent SDK no macOS (2026-11-04)

**Pergunta:** com `sandbox: { enabled: true, autoAllowBashIfSandboxed: false, filesystem: { allowWrite: [cwd], denyWrite: [cwd/.git/hooks, cwd/.git/config] } }`, o `@anthropic-ai/claude-agent-sdk` 0.3.314 barra escrita fora do projeto e em `.git/config`, e ainda chama o `canUseTool`?

**Como:** `node scripts/spike/claude-sandbox.mjs` (Haiku, repositório temporário). O agente roda: `touch dentro.txt`, `touch ~/tutti-sandbox-fora.txt`, `echo x >> .git/config` e `curl -sI https://example.com | head -1`.

**Resultado:**

| | Resultado |
|---|---|
| (a) `canUseTool` chamado para cada Bash? | **Sim**, para os 4. E aparece uma chamada a mais: `SandboxNetworkAccess` (a rede dentro do sandbox pede permissão por esse nome). |
| (b) dentro / fora / `.git/config` / rede | `dentro.txt` criado; `touch ~/…` → `Operation not permitted`; `>> .git/config` → `operation not permitted`; `curl` → `HTTP/1.1 200 Connection Established` (depois de liberado o `SandboxNetworkAccess`) |
| (c) arquivo fora existe depois? | **Não**. `.git/config` não mudou. |
| (d) campo que diz se o sandbox está ativo | **Não existe** no `system/init` nem no `initializationResult()`. |

**Conclusões para a Task 3:**
- O sandbox barra de verdade: o desenho do Sozinho para Claude se mantém.
- `SandboxNetworkAccess` precisa entrar na política como **internet** (livre no Sozinho, pede nos outros níveis).
- Sem campo de "ativo": o app liga o sandbox só se `/usr/bin/sandbox-exec` existe (macOS) e passa `failIfUnavailable: true`, para o SDK encerrar com erro em vez de rodar sem barreira. Sem `sandbox-exec`, o pedido vai sem sandbox, age como "Aceitar edições" e registra o aviso "Sozinho indisponível: usando Aceitar edições".
