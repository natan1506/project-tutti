# MCPs no Tutti — desenho

Data: 2026-11-09. Autor da conversa: Natan.

## 1. Por que

Hoje o Tutti só usa um MCP: o Linear, que o cérebro da esteira pega do `~/.claude.json` do Natan, com acesso só de leitura. O Natan quer poder **instalar MCPs no próprio Tutti** e que eles **funcionem em todos os agentes**, e não só no cérebro. Ele ainda não tem um MCP específico em mente: o recurso precisa ser geral.

### Sucesso
- O Natan instala um MCP pelo app ou pelo terminal, escolhe quem usa, e o MCP passa a aparecer para esses agentes no próximo pedido.
- O Linear e o Playwright do Claude Code entram com um clique (importar).
- Nenhum MCP escreve nada fora do projeto sem o Natan aprovar aquele uso.

### Antiobjetivos
- Um agente sem aprovação por uso (Codex, opencode) conseguir chamar ferramenta de escrita de um MCP.
- Segredo de MCP (token, chave) em texto puro no banco, em log, ou no env dos agentes CLI.
- Mexer na configuração global das ferramentas (por exemplo `agy mcp add` grava na config do Antigravity do Natan).

## 2. O que é

**Instalar:** pelo app (tela nova **MCPs**, ao lado de Skills) ou pelo terminal (`/mcp`, um painel como o `/config`). Cada MCP tem:
- **nome** (ex.: `linear`);
- **como iniciar**: comando + argumentos (stdio) — ex.: `npx -y mcp-remote https://mcp.linear.app/mcp` — ou URL (http);
- **variáveis secretas** opcionais (`env`), guardadas no Keychain;
- **modo**: **só leitura** ou **pode escrever**;
- **agentes**: quais usam (padrão: todos do perfil ativo);
- **ferramentas de leitura**: a lista que o Tutti considera só leitura (ver §4), que o Natan pode ajustar.

**Importar do Claude Code:** um botão lê o `mcpServers` do `~/.claude.json` e oferece cada um (hoje: `linear`, `playwright`) para importar, entrando como **só leitura** e para todos.

**Testar:** ao salvar, o Tutti conecta no MCP, lista as ferramentas e mostra quais considerou de leitura. Falhou a conexão → mostra o erro e salva desativado.

## 3. Como cada agente recebe

| Agente | Leitura | Escrita (MCP "pode escrever") |
|---|---|---|
| **Claude** (CLI) | livre | pede aprovação a cada uso (cartão no app; caixa "1. Permitir / 2. Negar" no terminal), via `canUseTool` |
| **Codex** | só as ferramentas de leitura, via `enabled_tools` na config do MCP | nunca recebe |
| **opencode** | só as de leitura (ferramentas de escrita desligadas na config que o Tutti gera) | nunca recebe |
| **Antigravity** | **sem MCP** — testado em 2026-11-09: `--settings` recusa `mcpServers` ("unknown setting"); o único caminho é `agy mcp add`, que grava na config global | nunca recebe |
| **Agentes por API** (via opencode) | como o opencode | nunca recebe |

- A autonomia vale para as ferramentas do MCP no Claude como para os comandos de hoje: no nível **Sozinho**, a escrita **ainda pede aprovação** (escrever fora do projeto é o tipo de coisa que o "Sozinho" não cobre).
- Consultas (modo `consult`) e triagem/escalação não recebem MCP.
- O cérebro da esteira recebe os MCPs como qualquer agente Claude (o Linear só leitura de hoje passa a ser só um desses MCPs).
- Executor e tester na esteira: recebem as **de leitura** dos MCPs marcados para eles. Escrita por MCP na esteira só se o executor for Claude e o Natan aprovar.

## 4. O que é "leitura"

- Pelo nome da ferramenta: começa com `get`, `list`, `search`, `read`, `fetch`, `find`, `query`, `describe`, `view`, `show`, `extract`, `browser_snapshot`, `browser_take_screenshot` (com `_` ou camelCase). O resto é escrita.
- Se a ferramenta trouxer a anotação MCP `readOnlyHint: true`, conta como leitura; `destructiveHint: true` conta como escrita, mesmo com nome de leitura.
- O Natan pode mudar qualquer ferramenta de lado na tela do MCP. A lista fica salva com o MCP.
- Ferramenta nova que aparecer depois (MCP atualizado) e não estiver na lista salva: escrita, até o Natan rever.

## 5. Restrições

- Segredos (`env`) no Keychain pelo mesmo `KeyStore` das chaves de API. No terminal, que não lê o Keychain do Electron, MCP com segredo fica indisponível (mesma limitação das chaves de API, avisada na tela).
- Nunca passar segredo pelo `env` do agente CLI: o segredo vai só para o processo do MCP (config do MCP), como o Claude Code faz.
- Banco: tabela/setting de MCPs no mesmo `time.db` (app e terminal enxergam os mesmos).
- MCP de rede (http) e `npx` fazem download: na primeira instalação o Tutti avisa que vai rodar o comando.

## 6. Decisões minhas (conferir)
- Playwright importado como **só leitura** libera só `browser_snapshot`/`browser_take_screenshot`/afins: navegar e clicar contam como escrita (o Natan pode mudar).
- O MCP do Linear do cérebro deixa de ser lido direto do `~/.claude.json`: passa a vir da lista do Tutti. Na primeira abertura após a atualização, o Tutti importa o `linear` do Claude Code automaticamente como só leitura, para nada parar de funcionar.

### Depois da revisão (minhas, conferir)
- **Segredo nunca na linha de comando** (o SDK do Claude passa `--mcp-config` e o do Codex `--config`, que aparecem no `ps`): o MCP com segredo é iniciado por um lançador do Tutti (`tutti-mcp-launch`), que lê o `env` de um arquivo temporário 0600 e então executa o comando de verdade; o arquivo é apagado quando o pedido acaba.
- **Playwright** entra **desligado** ao importar. Ligado, não vai para agentes que têm o navegador do Tutti (Claude por CLI): o navegador do Tutti é visível, tem a política por site e o "Assumir".
- **opencode**: um servidor só para todos os agentes opencode (Curinga e API); o MCP vai para o servidor se ao menos um agente opencode estiver marcado, só com as ferramentas de leitura. Mudança na lista reinicia o servidor só quando nenhum pedido opencode estiver rodando (senão, no próximo).
- **Cérebro**: recebe os MCPs marcados para o agente dele, **só leitura** (no meio do plano/revisão não há aprovação). Cérebro que não é Claude por CLI (TextBrain) fica sem MCP.
- **"Todos os agentes"** é dinâmico (agentes novos e outros perfis entram). É seguro porque escrita sempre pede aprovação por uso.

### Verificado em 2026-11-09
- Linear real importado pelo `McpService` (OAuth do `mcp-remote`): 70 ferramentas, 38 de leitura e 32 de escrita (`whoami` caiu em escrita pelo nome; dá para mover).
- Codex leu o título do DOKZ-2166 pelo Linear e só enxergou as 38 de leitura (`enabled_tools` funciona).
- Claude tentou `save_comment`: o Tutti pediu aprovação (motivo "ação de um MCP"), foi negada e nada foi escrito.
- opencode aceitou a config (servidor `fake` reconhecido; `fake_*` negado e `fake_get_thing` liberado nas permissões). A conexão ao vivo do MCP no opencode não foi vista sem um pedido.

## 7. O que fica com o construtor
- Layout da tela MCPs (seguir a de Skills) e do painel `/mcp`.
- Formato exato de como o Tutti guarda os MCPs.
- Tempo limite da conexão de teste.
